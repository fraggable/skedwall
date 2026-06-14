from __future__ import annotations

import json
import os
import random
import sys
import tempfile
import uuid
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from urllib.parse import quote
from zoneinfo import ZoneInfo

import psycopg
import requests

sys.path.append(str(Path(__file__).resolve().parents[1] / "python-renderer"))
from render import render_wallpaper  # noqa: E402

CALENDAR_SCOPES = {
    "https://www.googleapis.com/auth/calendar.readonly",
    "https://www.googleapis.com/auth/calendar.events.readonly",
}


def required_env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"{name} is not set")
    return value


def storage_headers() -> dict[str, str]:
    key = required_env("SUPABASE_SERVICE_ROLE_KEY")
    return {
        "apikey": key,
        "Authorization": f"Bearer {key}",
    }


def storage_url(path: str) -> str:
    base_url = (
        os.environ.get("SUPABASE_URL")
        or required_env("NEXT_PUBLIC_SUPABASE_URL")
    ).rstrip("/")
    bucket = required_env("SUPABASE_STORAGE_BUCKET")
    return f"{base_url}/storage/v1/object/{bucket}/{path}"


def download_storage(path: str, output: Path) -> None:
    response = requests.get(storage_url(path), headers=storage_headers(), timeout=60)
    response.raise_for_status()
    output.write_bytes(response.content)


def upload_storage(path: str, input_path: Path) -> None:
    headers = storage_headers()
    headers.update({"Content-Type": "image/jpeg", "x-upsert": "true"})
    response = requests.post(
        storage_url(path),
        headers=headers,
        data=input_path.read_bytes(),
        timeout=60,
    )
    response.raise_for_status()


def refresh_access_token(conn: psycopg.Connection, account: dict) -> str:
    response = requests.post(
        "https://oauth2.googleapis.com/token",
        data={
            "client_id": required_env("GOOGLE_CLIENT_ID"),
            "client_secret": required_env("GOOGLE_CLIENT_SECRET"),
            "refresh_token": account["refresh_token"],
            "grant_type": "refresh_token",
        },
        timeout=30,
    )
    response.raise_for_status()
    payload = response.json()
    expires_at = int(datetime.now(tz=timezone.utc).timestamp()) + int(
        payload.get("expires_in", 3600)
    )
    with conn.cursor() as cur:
        cur.execute(
            """
            update accounts
            set access_token = %s, expires_at = %s, token_type = %s, scope = coalesce(%s, scope)
            where id = %s
            """,
            (
                payload["access_token"],
                expires_at,
                payload.get("token_type"),
                payload.get("scope"),
                account["account_id"],
            ),
        )
    conn.commit()
    return payload["access_token"]


def get_access_token(conn: psycopg.Connection, account: dict) -> str:
    expires_at = account.get("expires_at") or 0
    now = int(datetime.now(tz=timezone.utc).timestamp())
    if account.get("access_token") and expires_at > now + 60:
        return account["access_token"]
    if not account.get("refresh_token"):
        raise RuntimeError("Google refresh token is missing")
    return refresh_access_token(conn, account)


def format_event_time(value: datetime) -> str:
    return value.strftime("%I:%M%p").lstrip("0")


def format_day_label(value: date, offset: int) -> str:
    if offset == 1:
        return "TOMORROW"
    return (value.strftime("%A, %b %-d") if os.name != "nt" else value.strftime("%A, %b %#d")).upper()


def has_google_meet(item: dict) -> bool:
    hangout_link = item.get("hangoutLink") or ""
    if "meet.google.com" in hangout_link:
        return True
    conference_data = item.get("conferenceData") or {}
    for entry_point in conference_data.get("entryPoints") or []:
        uri = entry_point.get("uri") or ""
        if entry_point.get("entryPointType") == "video" and "meet.google.com" in uri:
            return True
    return False


def can_read_calendar_events(calendar: dict) -> bool:
    return calendar.get("accessRole") in {"owner", "writer", "reader"}


def should_use_calendar(calendar: dict) -> bool:
    return bool(calendar.get("primary") or calendar.get("selected"))


def fetch_readable_calendar_ids(access_token: str) -> list[str]:
    calendar_ids: list[str] = []
    page_token: str | None = None

    while True:
        params = {
            "maxResults": 250,
            "minAccessRole": "reader",
            "fields": "nextPageToken,items(id,primary,selected,accessRole)",
        }
        if page_token:
            params["pageToken"] = page_token

        response = requests.get(
            "https://www.googleapis.com/calendar/v3/users/me/calendarList",
            headers={"Authorization": f"Bearer {access_token}"},
            params=params,
            timeout=30,
        )
        response.raise_for_status()
        payload = response.json()

        for calendar in payload.get("items", []):
            calendar_id = calendar.get("id")
            if calendar_id and can_read_calendar_events(calendar) and should_use_calendar(calendar):
                calendar_ids.append(calendar_id)

        page_token = payload.get("nextPageToken")
        if not page_token:
            break

    return calendar_ids or ["primary"]


def fetch_calendar_events(
    access_token: str,
    calendar_id: str,
    start: datetime,
    end: datetime,
    max_events: int,
) -> list[dict]:
    response = requests.get(
        f"https://www.googleapis.com/calendar/v3/calendars/{quote(calendar_id, safe='')}/events",
        headers={"Authorization": f"Bearer {access_token}"},
        params={
            "singleEvents": "true",
            "orderBy": "startTime",
            "timeMin": start.isoformat().replace("+00:00", "Z"),
            "timeMax": end.isoformat().replace("+00:00", "Z"),
            "maxResults": max(max_events * 8, 30),
            "fields": "items(id,iCalUID,summary,start,end,hangoutLink,conferenceData(entryPoints(entryPointType,uri)))",
        },
        timeout=30,
    )
    response.raise_for_status()

    return [dict(item, calendarId=calendar_id) for item in response.json().get("items", [])]


def parse_event_start(item: dict, tz: ZoneInfo) -> datetime | None:
    start = item.get("start") or {}
    start_time = start.get("dateTime")
    start_date = start.get("date")

    if start_time:
        return datetime.fromisoformat(start_time.replace("Z", "+00:00")).astimezone(tz)

    if start_date:
        return datetime.combine(date.fromisoformat(start_date), time.min, tzinfo=tz)

    return None


def fetch_calendar_days(access_token: str, tz_name: str, max_events: int, day_count: int = 3) -> list[dict]:
    tz = ZoneInfo(tz_name)
    today = datetime.now(tz).date()
    start = datetime.combine(today, time.min, tzinfo=tz).astimezone(timezone.utc)
    end = datetime.combine(today + timedelta(days=day_count), time.min, tzinfo=tz).astimezone(timezone.utc)
    days = [
        {
            "dateKey": (today + timedelta(days=offset)).isoformat(),
            "label": format_day_label(today + timedelta(days=offset), offset),
            "events": [],
        }
        for offset in range(day_count)
    ]
    day_by_key = {day["dateKey"]: day for day in days}
    events: list[dict] = []

    for calendar_id in fetch_readable_calendar_ids(access_token):
        events.extend(fetch_calendar_events(access_token, calendar_id, start, end, max_events))

    seen_events: set[tuple[str, str]] = set()
    events.sort(key=lambda item: parse_event_start(item, tz) or datetime.max.replace(tzinfo=tz))

    for item in events:
        start_dt = parse_event_start(item, tz)
        if not start_dt:
            continue

        start_payload = item.get("start") or {}
        end_payload = item.get("end") or {}
        start_time = start_payload.get("dateTime")
        end_time = end_payload.get("dateTime")
        dedupe_key = (
            item.get("iCalUID") or item.get("id") or item.get("summary") or "event",
            start_time or start_payload.get("date") or "",
        )

        if dedupe_key in seen_events:
            continue

        seen_events.add(dedupe_key)
        day = day_by_key.get(start_dt.date().isoformat())
        if not day:
            continue

        end_dt = (
            datetime.fromisoformat(end_time.replace("Z", "+00:00")).astimezone(tz)
            if end_time
            else None
        )
        day["events"].append(
            {
                "title": item.get("summary") or "Busy",
                "start": format_event_time(start_dt) if start_time else "ALL DAY",
                "end": format_event_time(end_dt) if end_dt else "",
                "hasMeet": has_google_meet(item),
            }
        )
    return days

def select_wallpaper(conn: psycopg.Connection, user: dict, today: date) -> dict:
    with conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(
            """
            select * from wallpapers
            where user_id = %s and is_enabled = true
            order by created_at desc
            """,
            (user["user_id"],),
        )
        wallpapers = cur.fetchall()
    if not wallpapers:
        raise RuntimeError("No enabled wallpapers are available")

    mode = user["wallpaper_mode"]
    selected_id = user.get("selected_wallpaper_id")
    if mode == "SELECTED" and selected_id:
        for wallpaper in wallpapers:
            if wallpaper["id"] == selected_id:
                return wallpaper

    if mode == "RANDOM_DAILY":
        with conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
            cur.execute(
                """
                select w.* from daily_wallpaper_selections d
                join wallpapers w on w.id = d.wallpaper_id
                where d.user_id = %s and d.date = %s and w.is_enabled = true
                """,
                (user["user_id"], today),
            )
            existing = cur.fetchone()
        if existing:
            return existing
        wallpaper = random.choice(wallpapers)
        with conn.cursor() as cur:
            cur.execute(
                """
                insert into daily_wallpaper_selections (id, user_id, wallpaper_id, date)
                values (%s, %s, %s, %s)
                on conflict (user_id, date) do update set wallpaper_id = excluded.wallpaper_id
                """,
                (str(uuid.uuid4()), user["user_id"], wallpaper["id"], today),
            )
        conn.commit()
        return wallpaper

    return wallpapers[0]


def record_generated(conn: psycopg.Connection, user_id: str, wallpaper_id: str | None, storage_path: str, today: date, status: str, error: str | None = None) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            insert into generated_images (id, user_id, wallpaper_id, storage_path, date, status, error_message)
            values (%s, %s, %s, %s, %s, %s, %s)
            """,
            (str(uuid.uuid4()), user_id, wallpaper_id, storage_path, today, status, error),
        )
    conn.commit()


def generate_for_user(conn: psycopg.Connection, user: dict) -> None:
    tz = ZoneInfo(user["timezone"])
    today = datetime.now(tz).date()
    wallpaper_id = None
    try:
        access_token = get_access_token(conn, user)
        days = fetch_calendar_days(access_token, user["timezone"], user["max_events"])
        wallpaper = select_wallpaper(conn, user, today)
        wallpaper_id = wallpaper["id"]
        generated_path = f"users/{user['user_id']}/generated/today.jpg"

        with tempfile.TemporaryDirectory(prefix="skedwall-") as tmp:
            root = Path(tmp)
            base_path = root / f"base{Path(wallpaper['storage_path']).suffix or '.jpg'}"
            output_path = root / "today.jpg"
            download_storage(wallpaper["storage_path"], base_path)
            render_wallpaper(
                {
                    "timezone": user["timezone"],
                    "days": days,
                    "baseWallpaperPath": str(base_path),
                    "width": 1290,
                    "height": 2796,
                },
                output_path,
            )
            upload_storage(generated_path, output_path)

        record_generated(conn, user["user_id"], wallpaper_id, generated_path, today, "SUCCESS")
        print(f"generated wallpaper for {user['email']}")
    except Exception as exc:
        record_generated(conn, user["user_id"], wallpaper_id, "", today, "FAILED", str(exc))
        print(f"failed for {user['email']}: {exc}")


def main() -> None:
    with psycopg.connect(required_env("DATABASE_URL")) as conn:
        with conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
            cur.execute(
                """
                select
                  u.id as user_id,
                  u.email,
                  s.timezone,
                  s.max_events,
                  s.wallpaper_mode,
                  s.selected_wallpaper_id,
                  a.id as account_id,
                  a.access_token,
                  a.refresh_token,
                  a.expires_at,
                  a.scope
                from users u
                join user_settings s on s.user_id = u.id
                join accounts a on a.user_id = u.id and a.provider = 'google'
                where s.generation_enabled = true
                """
            )
            users = cur.fetchall()

        for user in users:
            granted_scopes = set((user.get("scope") or "").split())
            if not granted_scopes.intersection(CALENDAR_SCOPES):
                print(f"skipping {user['email']}: calendar scope missing")
                continue
            generate_for_user(conn, user)


if __name__ == "__main__":
    main()
