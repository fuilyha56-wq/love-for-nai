"use client";

import { X } from "lucide-react";
import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from "react";

export type AdminButtonVariant = "primary" | "secondary" | "quiet" | "danger" | "icon";

const buttonClasses: Record<AdminButtonVariant, string> = {
  primary: "admin-button admin-button-primary",
  secondary: "admin-button admin-button-secondary",
  quiet: "admin-button admin-button-quiet",
  danger: "admin-button admin-button-danger",
  icon: "admin-button admin-button-icon",
};

export function AdminButton({
  variant = "secondary",
  loading = false,
  children,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: AdminButtonVariant;
  loading?: boolean;
}) {
  return (
    <button
      {...props}
      className={`${buttonClasses[variant]} ${className}`}
      disabled={loading || props.disabled}
    >
      {loading && <span className="admin-button-spinner" aria-hidden="true" />}
      {children}
    </button>
  );
}

export function AdminCard({
  title,
  description,
  actions,
  children,
  className = "",
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section className={`admin-card ${className}`}>
      {(title || description || actions) && (
        <header className="admin-card-header">
          <div className="min-w-0">
            {title && <h2 className="admin-card-title">{title}</h2>}
            {description && <p className="admin-card-description">{description}</p>}
          </div>
          {actions && <div className="admin-card-actions">{actions}</div>}
        </header>
      )}
      {children && <div className="admin-card-body">{children}</div>}
    </section>
  );
}

export function AdminToolbar({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`admin-toolbar ${className}`}>{children}</div>;
}

const badgeLabels: Record<string, string> = {
  draft: "草稿",
  published: "已发布",
  pending: "待审核",
  approved: "已通过",
  rejected: "已拒绝",
  withdrawn: "已撤回",
  expired: "已过期",
  warning: "需要关注",
  success: "正常",
  disabled: "已停用",
};

export function AdminStatusBadge({ status, label }: { status: string; label?: string }) {
  const tone = status === "approved" || status === "published" || status === "success"
    ? "is-success"
    : status === "rejected" || status === "withdrawn" || status === "expired" || status === "disabled"
      ? "is-danger"
      : status === "warning" || status === "pending"
        ? "is-warning"
        : "is-neutral";
  return <span className={`admin-status-badge ${tone}`}>{label || badgeLabels[status] || status}</span>;
}

export function AdminEmptyState({ children }: { children: ReactNode }) {
  return <div className="admin-empty-state">{children}</div>;
}

export function AdminTable({
  children,
  minWidth = "680px",
}: {
  children: ReactNode;
  minWidth?: string;
}) {
  return <div className="admin-table-wrap"><table className="admin-table" style={{ minWidth }}>{children}</table></div>;
}

export function AdminDialog({
  title,
  description,
  children,
  onClose,
  footer,
  wide = false,
}: {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previous?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="admin-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="admin-dialog-title" className={`admin-dialog ${wide ? "admin-dialog-wide" : ""}`}>
        <header className="admin-dialog-header">
          <div className="min-w-0"><h2 id="admin-dialog-title" className="admin-card-title">{title}</h2>{description && <p className="admin-card-description">{description}</p>}</div>
          <AdminButton variant="icon" onClick={onClose} aria-label="关闭"><X size={16} /></AdminButton>
        </header>
        <div className="admin-dialog-body">{children}</div>
        {footer && <footer className="admin-dialog-footer">{footer}</footer>}
      </div>
    </div>
  );
}

export function AdminConfirmDialog({
  title,
  description,
  confirmLabel = "确认",
  danger = false,
  loading = false,
  onCancel,
  onConfirm,
}: {
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  loading?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return <AdminDialog title={title} description={description} onClose={onCancel} footer={<><AdminButton variant="secondary" onClick={onCancel}>取消</AdminButton><AdminButton variant={danger ? "danger" : "primary"} loading={loading} onClick={onConfirm}>{confirmLabel}</AdminButton></>}><p className="text-sm leading-6 text-[var(--muted)]">该操作会立即生效，请确认影响范围后继续。</p></AdminDialog>;
}
