// Design Doc §3.2.
export const SESSION_TYPES = ["L", "R", "G", "P", "S", "X", "Gallery", "Party"] as const;

// Matches JS Date.getDay() (0=Sunday..6=Saturday).
export const DAYS_OF_WEEK = [
  { value: 0, label: "Sunday" },
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
] as const;
