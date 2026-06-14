export const GOOGLE_CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.events.readonly",
];

export const GOOGLE_AUTH_SCOPE = [
  "openid",
  "email",
  "profile",
  ...GOOGLE_CALENDAR_SCOPES,
].join(" ");

export function hasGoogleCalendarScope(scope: string | null | undefined) {
  const grantedScopes = new Set((scope ?? "").split(/\s+/).filter(Boolean));

  return GOOGLE_CALENDAR_SCOPES.some((calendarScope) =>
    grantedScopes.has(calendarScope),
  );
}

export function getMissingCalendarScopeMessage() {
  return "Reconnect Google Calendar so skedwall can read your calendar events.";
}