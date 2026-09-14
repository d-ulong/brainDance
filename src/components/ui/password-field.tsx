"use client";

import { useState } from "react";

import { Field, TextInput } from "@/components/ui/page-shell";

type PasswordFieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  testId: string;
  autoComplete?: string;
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  disabled?: boolean;
};

export function PasswordField({
  label,
  value,
  onChange,
  testId,
  autoComplete,
  required,
  minLength,
  maxLength,
  disabled,
}: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);

  return (
    <Field label={label}>
      <div className="flex gap-2">
        <TextInput
          data-testid={testId}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          required={required}
          minLength={minLength}
          maxLength={maxLength}
          disabled={disabled}
          className="min-w-0 flex-1"
        />
        <button
          type="button"
          data-testid={`${testId}-toggle`}
          className="min-h-11 shrink-0 rounded-xl border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-800 hover:bg-neutral-50"
          aria-label={visible ? "隐藏密码" : "显示密码"}
          aria-pressed={visible}
          onClick={() => setVisible((current) => !current)}
        >
          <svg
            aria-hidden="true"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
          >
            <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
            <circle cx="12" cy="12" r="3" />
            {visible ? <path d="m3 3 18 18" /> : null}
          </svg>
        </button>
      </div>
    </Field>
  );
}
