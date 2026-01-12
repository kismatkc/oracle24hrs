// app/common_routes/stopwatch/index.ts


export type HabitCriterion = {
  id: string;
  title: string;
  minutes: number; // per-criterion threshold in minutes
};

export type DayTracker = {
  habitId: string;
  userId: string;
  dayKey: string; // "YYYY-MM-DD" in your tz/reset rule
  status: "running" | "paused" | "completed" | "canceled";
  minDailyMs: number; // snapshot for that day (legacy parent threshold)
  progressMs: number; // cached sum of segments (parent or all criteria)
  startedAt: number | null; // when the open segment began
  lastConfirmAt: number | null; // last "Yes, still learning?" time
  /** which criterion (if any) is currently running */
  currentCriterionId?: string | null;

  createdAt: number;
  updatedAt: number;
};

export type Segment = {
  startMs: number;
  endMs: number | null;
};

export type NudgeJob = {
  habitId: string;
  dayKey: string;
  userId: string;
  /** optional: goal job tied to a specific criterion */
  criterionId?: string | null;
};
