import { prisma } from "@/lib/prisma";

export type SanitizedCalendarEvent = {
  title: string;
  start: string;
  end: string;
  hasMeet: boolean;
};

export type SanitizedCalendarDay = {
  dateKey: string;
  label: string;
  events: SanitizedCalendarEvent[];
};

type GoogleCalendarItem = {
  id?: string;
  iCalUID?: string;
  calendarId?: string;
  summary?: string;
  hangoutLink?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
  conferenceData?: {
    entryPoints?: {
      entryPointType?: string;
      uri?: string;
    }[];
  };
};

type GoogleCalendarListItem = {
  id?: string;
  primary?: boolean;
  selected?: boolean;
  accessRole?: string;
};

function getDateParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );

  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
    second: values.second,
  };
}

function zonedTimeToUtc(
  input: {
    year: number;
    month: number;
    day: number;
    hour?: number;
    minute?: number;
    second?: number;
  },
  timeZone: string,
) {
  const utcGuess = Date.UTC(
    input.year,
    input.month - 1,
    input.day,
    input.hour ?? 0,
    input.minute ?? 0,
    input.second ?? 0,
  );
  const actualParts = getDateParts(new Date(utcGuess), timeZone);
  const actualAsUtc = Date.UTC(
    actualParts.year,
    actualParts.month - 1,
    actualParts.day,
    actualParts.hour,
    actualParts.minute,
    actualParts.second,
  );

  return new Date(utcGuess - (actualAsUtc - utcGuess));
}

function partsToDateKey(parts: { year: number; month: number; day: number }) {
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(
    parts.day,
  ).padStart(2, "0")}`;
}

function getDayParts(timeZone: string, dayOffset: number) {
  const today = getDateParts(new Date(), timeZone);
  const shiftedUtc = new Date(
    Date.UTC(today.year, today.month - 1, today.day + dayOffset),
  );

  return getDateParts(shiftedUtc, "UTC");
}

export function getTodayKey(timeZone: string, date = new Date()) {
  return partsToDateKey(getDateParts(date, timeZone));
}

export function getDateAtUtcMidnight(dateKey: string) {
  return new Date(`${dateKey}T00:00:00.000Z`);
}

function getDayBounds(timeZone: string, startOffset = 0, dayCount = 1) {
  const start = zonedTimeToUtc(getDayParts(timeZone, startOffset), timeZone);
  const end = zonedTimeToUtc(
    getDayParts(timeZone, startOffset + dayCount),
    timeZone,
  );

  return { start, end };
}

function formatDayLabel(dateKey: string, dayOffset: number) {
  if (dayOffset === 1) {
    return "TOMORROW";
  }

  const date = getDateAtUtcMidnight(dateKey);
  const label = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "short",
    day: "numeric",
  }).format(date);

  return label.toUpperCase();
}

function formatEventTime(dateTime: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
    .format(new Date(dateTime))
    .replace(/\s/g, "")
    .toUpperCase();
}

function hasGoogleMeet(event: GoogleCalendarItem) {
  if (event.hangoutLink?.includes("meet.google.com")) {
    return true;
  }

  return (
    event.conferenceData?.entryPoints?.some(
      (entryPoint) =>
        entryPoint.entryPointType === "video" &&
        (entryPoint.uri?.includes("meet.google.com") ?? false),
    ) ?? false
  );
}

type GoogleErrorPayload = {
  error?: {
    code?: number;
    message?: string;
    status?: string;
  };
  error_description?: string;
};

async function getGoogleErrorMessage(response: Response, prefix: string) {
  let detail = "";

  try {
    const payload = (await response.clone().json()) as GoogleErrorPayload;
    detail =
      payload.error?.message ?? payload.error_description ?? payload.error?.status ?? "";
  } catch {
    try {
      detail = await response.text();
    } catch {
      detail = "";
    }
  }

  const message = `${prefix}: ${response.status}${detail ? ` - ${detail}` : ""}`;

  if (response.status === 403) {
    return `${message}. Check that the Google Calendar API is enabled, then reconnect Google Calendar from the dashboard.`;
  }

  if (response.status === 401) {
    return `${message}. Reconnect Google from the sign-in flow so a fresh access token can be stored.`;
  }

  return message;
}

async function refreshAccessToken(accountId: string, refreshToken: string) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!response.ok) {
    throw new Error(
      await getGoogleErrorMessage(response, "Google token refresh failed"),
    );
  }

  const payload = (await response.json()) as {
    access_token: string;
    expires_in?: number;
    token_type?: string;
    scope?: string;
  };

  await prisma.account.update({
    where: { id: accountId },
    data: {
      access_token: payload.access_token,
      expires_at: payload.expires_in
        ? Math.floor(Date.now() / 1000) + payload.expires_in
        : undefined,
      token_type: payload.token_type,
      scope: payload.scope,
    },
  });

  return payload.access_token;
}

async function getGoogleAccessToken(userId: string) {
  const account = await prisma.account.findFirst({
    where: {
      userId,
      provider: "google",
    },
  });

  if (!account) {
    throw new Error("Google account is not connected");
  }

  const expiresAtMs = account.expires_at ? account.expires_at * 1000 : 0;

  if (account.access_token && expiresAtMs > Date.now() + 60_000) {
    return account.access_token;
  }

  if (!account.refresh_token) {
    throw new Error("Google refresh token is missing; reconnect Google");
  }

  return refreshAccessToken(account.id, account.refresh_token);
}

function canReadCalendarEvents(calendar: GoogleCalendarListItem) {
  return ["owner", "writer", "reader"].includes(calendar.accessRole ?? "");
}

function shouldUseCalendar(calendar: GoogleCalendarListItem) {
  return Boolean(calendar.primary || calendar.selected);
}

async function fetchReadableCalendarIds(accessToken: string) {
  const calendarIds: string[] = [];
  let pageToken: string | undefined;

  do {
    const url = new URL(
      "https://www.googleapis.com/calendar/v3/users/me/calendarList",
    );

    url.searchParams.set("maxResults", "250");
    url.searchParams.set("minAccessRole", "reader");
    url.searchParams.set(
      "fields",
      "nextPageToken,items(id,primary,selected,accessRole)",
    );

    if (pageToken) {
      url.searchParams.set("pageToken", pageToken);
    }

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      throw new Error(
        await getGoogleErrorMessage(response, "Google Calendar list failed"),
      );
    }

    const payload = (await response.json()) as {
      items?: GoogleCalendarListItem[];
      nextPageToken?: string;
    };

    for (const calendar of payload.items ?? []) {
      if (calendar.id && canReadCalendarEvents(calendar) && shouldUseCalendar(calendar)) {
        calendarIds.push(calendar.id);
      }
    }

    pageToken = payload.nextPageToken;
  } while (pageToken);

  return calendarIds.length > 0 ? calendarIds : ["primary"];
}

function eventStartSortValue(event: GoogleCalendarItem) {
  const start = event.start?.dateTime ?? event.start?.date;

  if (!start) {
    return Number.POSITIVE_INFINITY;
  }

  return Date.parse(event.start?.dateTime ?? `${start}T00:00:00.000Z`);
}

async function fetchCalendarEvents(
  accessToken: string,
  calendarId: string,
  start: Date,
  end: Date,
  maxEvents: number,
) {
  const url = new URL(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
      calendarId,
    )}/events`,
  );

  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "startTime");
  url.searchParams.set("timeMin", start.toISOString());
  url.searchParams.set("timeMax", end.toISOString());
  url.searchParams.set("maxResults", String(Math.max(maxEvents * 8, 30)));
  url.searchParams.set(
    "fields",
    "items(id,iCalUID,summary,start,end,hangoutLink,conferenceData(entryPoints(entryPointType,uri)))",
  );

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(
      await getGoogleErrorMessage(
        response,
        `Google Calendar request failed for ${calendarId}`,
      ),
    );
  }

  const payload = (await response.json()) as { items?: GoogleCalendarItem[] };

  return (payload.items ?? []).map((event) => ({
    ...event,
    calendarId,
  }));
}

export async function fetchCalendarDays(
  userId: string,
  timeZone: string,
  maxEvents: number,
  dayCount = 3,
): Promise<SanitizedCalendarDay[]> {
  const accessToken = await getGoogleAccessToken(userId);
  const { start, end } = getDayBounds(timeZone, 0, dayCount);
  const days = Array.from({ length: dayCount }, (_, index) => {
    const dateKey = partsToDateKey(getDayParts(timeZone, index));

    return {
      dateKey,
      label: formatDayLabel(dateKey, index),
      events: [] as SanitizedCalendarEvent[],
    };
  });
  const dayByKey = new Map(days.map((day) => [day.dateKey, day]));
  const calendarIds = await fetchReadableCalendarIds(accessToken);
  const eventGroups = await Promise.all(
    calendarIds.map((calendarId) =>
      fetchCalendarEvents(accessToken, calendarId, start, end, maxEvents),
    ),
  );
  const seenEvents = new Set<string>();
  const events = eventGroups.flat().sort((left, right) => {
    return eventStartSortValue(left) - eventStartSortValue(right);
  });

  for (const event of events) {
    const startDateTime = event.start?.dateTime;
    const endDateTime = event.end?.dateTime;
    const startDate = event.start?.date;

    if (!startDateTime && !startDate) {
      continue;
    }

    const dedupeKey = [
      event.iCalUID ?? event.id ?? event.summary ?? "event",
      startDateTime ?? startDate,
    ].join(":");

    if (seenEvents.has(dedupeKey)) {
      continue;
    }

    seenEvents.add(dedupeKey);

    const dateKey = startDateTime
      ? getTodayKey(timeZone, new Date(startDateTime))
      : startDate;
    const day = dateKey ? dayByKey.get(dateKey) : undefined;

    if (!day) {
      continue;
    }

    day.events.push({
      title: event.summary?.trim() || "Busy",
      start: startDateTime ? formatEventTime(startDateTime, timeZone) : "ALL DAY",
      end: endDateTime ? formatEventTime(endDateTime, timeZone) : "",
      hasMeet: hasGoogleMeet(event),
    });
  }

  return days;
}

export async function fetchTodayCalendarEvents(
  userId: string,
  timeZone: string,
  maxEvents: number,
): Promise<SanitizedCalendarEvent[]> {
  const [today] = await fetchCalendarDays(userId, timeZone, maxEvents, 1);

  return today.events.slice(0, maxEvents);
}