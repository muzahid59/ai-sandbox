import React, { useState, useEffect } from 'react';
import cronstrue from 'cronstrue';
import styles from './ScheduleBuilder.module.css';

type Frequency = 'minutes' | 'daily' | 'weekly' | 'monthly';

interface ScheduleState {
  frequency: Frequency;
  intervalMinutes: number;
  hour: number;
  minute: number;
  selectedDays: number[];
  dayOfMonth: number;
}

interface ScheduleBuilderProps {
  value: string;
  onChange: (cron: string) => void;
  error?: string;
}

const MINUTE_OPTIONS = [1, 2, 5, 10, 15, 20, 30, 60];
const DAYS_OF_WEEK = [
  { label: 'Mon', value: 1 },
  { label: 'Tue', value: 2 },
  { label: 'Wed', value: 3 },
  { label: 'Thu', value: 4 },
  { label: 'Fri', value: 5 },
  { label: 'Sat', value: 6 },
  { label: 'Sun', value: 0 },
];

const DEFAULT_STATE: ScheduleState = {
  frequency: 'daily',
  intervalMinutes: 5,
  hour: 9,
  minute: 0,
  selectedDays: [1, 2, 3, 4, 5],
  dayOfMonth: 1,
};

function buildCron(state: ScheduleState): string {
  switch (state.frequency) {
    case 'minutes':
      if (state.intervalMinutes === 60) return '0 * * * *';
      return `*/${state.intervalMinutes} * * * *`;
    case 'daily':
      return `${state.minute} ${state.hour} * * *`;
    case 'weekly': {
      const days = state.selectedDays.length > 0
        ? [...state.selectedDays].sort((a, b) => a - b).join(',')
        : '*';
      return `${state.minute} ${state.hour} * * ${days}`;
    }
    case 'monthly':
      return `${state.minute} ${state.hour} ${state.dayOfMonth} * *`;
  }
}

function expandRange(range: string): number[] {
  if (range.includes('-')) {
    const [start, end] = range.split('-').map(Number);
    const result: number[] = [];
    for (let i = start; i <= end; i++) result.push(i);
    return result;
  }
  return [Number(range)];
}

function parseCron(expr: string): ScheduleState | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [minField, hourField, domField, monthField, dowField] = parts;

  if (monthField !== '*') return null;

  // Minutes: */N * * * *
  if (minField.startsWith('*/') && hourField === '*' && domField === '*' && dowField === '*') {
    const interval = Number(minField.slice(2));
    if (MINUTE_OPTIONS.includes(interval)) {
      return { ...DEFAULT_STATE, frequency: 'minutes', intervalMinutes: interval };
    }
    return null;
  }

  // Hourly: 0 * * * *
  if (minField === '0' && hourField === '*' && domField === '*' && dowField === '*') {
    return { ...DEFAULT_STATE, frequency: 'minutes', intervalMinutes: 60 };
  }

  const min = Number(minField);
  const hour = Number(hourField);
  if (isNaN(min) || isNaN(hour)) return null;

  // Monthly: N N N * *
  if (domField !== '*' && dowField === '*') {
    const dom = Number(domField);
    if (isNaN(dom)) return null;
    return { ...DEFAULT_STATE, frequency: 'monthly', hour, minute: min, dayOfMonth: dom };
  }

  // Weekly: N N * * days
  if (domField === '*' && dowField !== '*') {
    const days = dowField.split(',').flatMap(expandRange);
    if (days.some(isNaN)) return null;
    return { ...DEFAULT_STATE, frequency: 'weekly', hour, minute: min, selectedDays: days };
  }

  // Daily: N N * * *
  if (domField === '*' && dowField === '*') {
    return { ...DEFAULT_STATE, frequency: 'daily', hour, minute: min };
  }

  return null;
}

function getCronPreview(cron: string): string | null {
  try {
    return cronstrue.toString(cron);
  } catch {
    return null;
  }
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5);

const ScheduleBuilder: React.FC<ScheduleBuilderProps> = ({ value, onChange, error }) => {
  const [state, setState] = useState<ScheduleState>(() => parseCron(value) ?? DEFAULT_STATE);
  const [isAdvanced, setIsAdvanced] = useState(() => value !== '' && parseCron(value) === null);

  useEffect(() => {
    if (!isAdvanced) {
      onChange(buildCron(state));
    }
  }, [state, isAdvanced, onChange]);

  function update(patch: Partial<ScheduleState>) {
    setIsAdvanced(false);
    setState((prev) => ({ ...prev, ...patch }));
  }

  function toggleDay(day: number) {
    setState((prev) => {
      const has = prev.selectedDays.includes(day);
      const next = has
        ? prev.selectedDays.filter((d) => d !== day)
        : [...prev.selectedDays, day];
      return { ...prev, selectedDays: next };
    });
  }

  const frequencies: { key: Frequency; label: string }[] = [
    { key: 'minutes', label: 'Minutes' },
    { key: 'daily', label: 'Daily' },
    { key: 'weekly', label: 'Weekly' },
    { key: 'monthly', label: 'Monthly' },
  ];

  const preview = getCronPreview(isAdvanced ? value : buildCron(state));
  const weeklyNoDays = state.frequency === 'weekly' && state.selectedDays.length === 0;

  const timePicker = (
    <div className={styles.inlineRow}>
      <span className={styles.inlineLabel}>At</span>
      <select
        className={styles.select}
        value={state.hour}
        onChange={(e) => update({ hour: Number(e.target.value) })}
        aria-label="Hour"
      >
        {HOURS.map((h) => (
          <option key={h} value={h}>{pad(h)}</option>
        ))}
      </select>
      <span className={styles.inlineLabel}>:</span>
      <select
        className={styles.select}
        value={state.minute}
        onChange={(e) => update({ minute: Number(e.target.value) })}
        aria-label="Minute"
      >
        {MINUTES.map((m) => (
          <option key={m} value={m}>{pad(m)}</option>
        ))}
      </select>
    </div>
  );

  return (
    <div className={styles.container}>
      <div className={styles.frequencyGroup} role="radiogroup" aria-label="Schedule frequency">
        {frequencies.map((f) => (
          <button
            key={f.key}
            type="button"
            role="radio"
            aria-checked={!isAdvanced && state.frequency === f.key}
            className={`${styles.frequencyPill} ${!isAdvanced && state.frequency === f.key ? styles.frequencyPillActive : ''}`}
            onClick={() => update({ frequency: f.key })}
          >
            {f.label}
          </button>
        ))}
      </div>

      {isAdvanced ? (
        <div className={styles.contextFields}>
          <div className={styles.advancedBanner}>
            This schedule uses an advanced expression. Edit below or choose a frequency above.
          </div>
          <input
            className={styles.input}
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="e.g. 0 9 * * 1-5"
            aria-label="Cron expression"
          />
        </div>
      ) : (
        <div className={styles.contextFields}>
          {state.frequency === 'minutes' && (
            <div className={styles.inlineRow}>
              <span className={styles.inlineLabel}>Every</span>
              <select
                className={styles.select}
                value={state.intervalMinutes}
                onChange={(e) => update({ intervalMinutes: Number(e.target.value) })}
                aria-label="Interval in minutes"
              >
                {MINUTE_OPTIONS.map((n) => (
                  <option key={n} value={n}>{n === 60 ? '60 (hourly)' : n}</option>
                ))}
              </select>
              <span className={styles.inlineLabel}>minutes</span>
            </div>
          )}

          {state.frequency === 'daily' && timePicker}

          {state.frequency === 'weekly' && (
            <>
              <div className={styles.dayPills}>
                {DAYS_OF_WEEK.map((d) => (
                  <button
                    key={d.value}
                    type="button"
                    aria-pressed={state.selectedDays.includes(d.value)}
                    className={`${styles.dayPill} ${state.selectedDays.includes(d.value) ? styles.dayPillActive : ''}`}
                    onClick={() => toggleDay(d.value)}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
              {weeklyNoDays && (
                <span className={styles.fieldError}>Select at least one day</span>
              )}
              {timePicker}
            </>
          )}

          {state.frequency === 'monthly' && (
            <div className={styles.inlineRow}>
              <span className={styles.inlineLabel}>On day</span>
              <select
                className={styles.select}
                value={state.dayOfMonth}
                onChange={(e) => update({ dayOfMonth: Number(e.target.value) })}
                aria-label="Day of month"
              >
                {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
              {timePicker}
            </div>
          )}
        </div>
      )}

      {preview && <span className={styles.preview} aria-live="polite">{preview}</span>}
      {error && <span className={styles.fieldError}>{error}</span>}
    </div>
  );
};

export default ScheduleBuilder;
