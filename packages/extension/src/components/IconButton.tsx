import type { ButtonHTMLAttributes, ReactNode } from "react";

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  tone?: "neutral" | "danger" | "primary";
  children: ReactNode;
};

export const IconButton = ({ label, tone = "neutral", children, className = "", ...props }: IconButtonProps) => (
  <button className={`icon-button ${tone} ${className}`.trim()} aria-label={label} title={label} {...props}>
    {children}
  </button>
);
