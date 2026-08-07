export const REPORTING_TIME_ZONE = 'Europe/Paris';

const dateKeyFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: REPORTING_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export const getReportingDateKey = (value = new Date()) => {
  const parts = Object.fromEntries(
    dateKeyFormatter
      .formatToParts(new Date(value))
      .filter(({ type }) => type !== 'literal')
      .map(({ type, value: partValue }) => [type, partValue])
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
};

export const getReportingDateBucket = (value = new Date()) =>
  new Date(`${getReportingDateKey(value)}T00:00:00.000Z`);

export const getRecentReportingDateKeys = (days, value = new Date()) => {
  const currentKey = getReportingDateKey(value);
  const currentDate = new Date(`${currentKey}T12:00:00.000Z`);
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(currentDate);
    date.setUTCDate(date.getUTCDate() - (days - 1 - index));
    return date.toISOString().slice(0, 10);
  });
};

export const getReportingWeekday = (dateKey) =>
  new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    weekday: 'short',
  }).format(new Date(`${dateKey}T12:00:00.000Z`));
