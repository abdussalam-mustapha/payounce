/** Builds an iCalendar file with a member's payment deadlines and payout date, so reminders work in any calendar app. */
type IcsEvent = { uid: string; start: number; title: string; description: string; url: string };

const stamp = (ts: number) => new Date(ts * 1000).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");

export function buildIcs(calendarName: string, events: IcsEvent[]) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Payounce//Savings circle//EN",
    "CALSCALE:GREGORIAN",
    `X-WR-CALNAME:${esc(calendarName)}`,
  ];
  for (const e of events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${e.uid}@payounce`,
      `DTSTAMP:${stamp(Math.floor(Date.now() / 1000))}`,
      `DTSTART:${stamp(e.start)}`,
      `DTEND:${stamp(e.start + 1800)}`,
      `SUMMARY:${esc(e.title)}`,
      `DESCRIPTION:${esc(e.description)}`,
      `URL:${e.url}`,
      // Remind a day before and an hour before.
      "BEGIN:VALARM", "ACTION:DISPLAY", "TRIGGER:-P1D", `DESCRIPTION:${esc(e.title)}`, "END:VALARM",
      "BEGIN:VALARM", "ACTION:DISPLAY", "TRIGGER:-PT1H", `DESCRIPTION:${esc(e.title)}`, "END:VALARM",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

export function downloadFile(filename: string, content: string, type = "text/calendar") {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
