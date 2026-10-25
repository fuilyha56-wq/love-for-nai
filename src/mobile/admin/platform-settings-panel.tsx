"use client";

import { ArrowLeft, ArrowUpRight, Save } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { DEFAULT_AUTH_POLICY, registrationMethods } from "@/lib/auth-policy";
import {
  SETTINGS_GROUPS,
  SETTINGS_PAGES,
  type SettingsPage,
} from "@/lib/platform-settings-sections";
import type { RuntimeSettings } from "@/lib/runtime-config";
import { PopupSelect } from "@/mobile/ui/popup-select";
import { lfnConfirm } from "@/mobile/ui/lfn-dialog";
import "./platform-settings.css";

export default function PlatformSettingsPanel({
  page,
  onNavigate,
  setMessage,
}: {
  page: SettingsPage;
  onNavigate: (page: SettingsPage | "endpoints" | "gateway") => void;
  setMessage: (message: string) => void;
}) {
  const [settings, setSettings] = useState<RuntimeSettings | null>(null);
  const [original, setOriginal] = useState<RuntimeSettings | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [reload, setReload] = useState(0);
  const groups = SETTINGS_GROUPS[page];
  const title =
    page === "platform"
      ? "平台配置"
      : SETTINGS_PAGES.find((item) => item.id === page)!.label;
  const keys = groups.flatMap((group) =>
    group.fields.map((field) => field.key),
  );
  const dirtyKeys =
    settings && original
      ? keys.filter((key) => settings[key] !== original[key])
      : [];

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/platform/settings", { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || "配置读取失败");
        if (!cancelled) {
          const loaded = { ...DEFAULT_AUTH_POLICY, ...result.settings };
          setSettings(loaded);
          setOriginal(loaded);
          setError("");
        }
      })
      .catch((reason) => {
        if (!cancelled)
          setError(reason instanceof Error ? reason.message : "配置读取失败");
      });
    return () => {
      cancelled = true;
    };
  }, [reload]);

  useEffect(() => {
    if (!dirtyKeys.length) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    const navigate = (event: Event) => {
      event.preventDefault();
      const proceed = (event as CustomEvent<{ onConfirm: () => void }>).detail?.onConfirm;
      void lfnConfirm("当前页面有未保存的设置，确定离开？").then(confirmed => {
        if (confirmed) proceed?.();
      });
    };
    window.addEventListener("beforeunload", warn);
    window.addEventListener("lfn-mobile-platform-before-navigate", navigate);
    return () => {
      window.removeEventListener("beforeunload", warn);
      window.removeEventListener("lfn-mobile-platform-before-navigate", navigate);
    };
  }, [dirtyKeys.length]);

  function navigate(next: SettingsPage | "endpoints" | "gateway") {
    onNavigate(next);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!settings || !dirtyKeys.length) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const patch = Object.fromEntries(
        dirtyKeys.map((key) => [key, settings[key]]),
      );
      const response = await fetch("/api/admin/platform/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "保存失败");
      const saved = { ...DEFAULT_AUTH_POLICY, ...result.settings };
      setSettings(saved);
      setOriginal(saved);
      setMessage(`${title}已保存，立即生效`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "保存失败，请重试");
    } finally {
      setSaving(false);
    }
  }

  if (!settings)
    return (
      <div className="admin-card p-5" role="status">
        {error || "正在读取配置…"}
        {error && (
          <button
            className="admin-button ml-3"
            onClick={() => setReload((value) => value + 1)}
          >
            重试
          </button>
        )}
      </div>
    );

  return (
    <div className="platform-settings">
      {page !== "platform" && (
        <button
          type="button"
          className="platform-back"
          onClick={() => navigate("platform")}
        >
          <ArrowLeft size={14} />
          返回平台配置
        </button>
      )}
      <form onSubmit={save}>
        <div className="platform-settings-toolbar">
          <div>
            <h2>{title}</h2>
            <p>
              {dirtyKeys.length
                ? `有 ${dirtyKeys.length} 项修改未保存`
                : "修改后保存，仅更新当前页面的配置。"}
            </p>
          </div>
          <button
            type="submit"
            disabled={saving || !dirtyKeys.length}
            className="admin-button admin-button-primary"
          >
            <Save size={15} />
            {saving ? "保存中…" : "保存设置"}
          </button>
        </div>
        {error && (
          <p className="platform-settings-error" role="alert">
            {error}
          </p>
        )}
        {page === "authentication" && (
          <div className="platform-policy-summary" role="status">
            <b>当前开放</b>
            <span>
              登录：
              {[
                settings.passwordLoginEnabled && "密码",
                settings.tokenLoginEnabled &&
                  settings.authProvider !== "local" &&
                  "访问令牌",
              ]
                .filter(Boolean)
                .join("、") || "已全部关闭"}
            </span>
            <span>
              注册：
              {registrationMethods(settings)
                .map((method) => (method === "email" ? "邮箱" : "邀请码"))
                .join("、") || "已全部关闭"}
            </span>
            <span>{settings.requireInviteCode ? "所有注册均须有效邀请码" : "未强制邀请码"}</span>
            <span>
              {settings.requireEmailVerification
                ? "所有新账户均需验证邮箱"
                : "未要求邮箱验证"}
            </span>
          </div>
        )}
        <fieldset disabled={saving} className="platform-settings-groups">
          {groups.map((group) => (
            <section key={group.title} className="admin-card">
              <header className="admin-card-header">
                <div>
                  <h3 className="admin-card-title">{group.title}</h3>
                  {group.description && (
                    <p className="admin-card-description">
                      {group.description}
                    </p>
                  )}
                </div>
              </header>
              <div className="platform-fields">
                {group.fields.map((field) => {
                  const id = `setting-${field.key}`;
                  const disabled = Boolean(
                    field.dependsOn &&
                      !settings[field.dependsOn] &&
                      !field.editableWhenInactive,
                  );
                  const value = settings[field.key];
                  const update = (next: string | number | boolean) =>
                    setSettings({ ...settings, [field.key]: next });
                  if (field.type === "switch")
                    return (
                      <div
                        key={field.key}
                        className={`platform-switch-row ${disabled ? "is-disabled" : ""}`}
                      >
                        <div>
                          <label htmlFor={id}>{field.label}</label>
                          {field.hint && <p id={`${id}-hint`}>{field.hint}</p>}
                        </div>
                        <button
                          id={id}
                          type="button"
                          role="switch"
                          aria-checked={Boolean(value)}
                          aria-label={field.label}
                          aria-describedby={
                            field.hint ? `${id}-hint` : undefined
                          }
                          disabled={disabled}
                          className={`platform-switch ${value ? "is-on" : ""}`}
                          onClick={() => update(!value)}
                        >
                          <span />
                        </button>
                      </div>
                    );
                  return (
                    <div
                      key={field.key}
                      className={`platform-field ${field.type === "textarea" ? "is-wide" : ""}`}
                    >
                      <label htmlFor={id}>{field.label}</label>
                      {field.type === "select" ? (
                        <PopupSelect
                          value={String(value)}
                          onChange={update}
                          ariaLabel={field.label}
                          options={[
                            { value: "newapi", label: "NewAPI 账号" },
                            { value: "local", label: "本地账号" },
                          ]}
                        />
                      ) : field.type === "textarea" ? (
                        <textarea
                          id={id}
                          className="field"
                          rows={9}
                          disabled={disabled}
                          value={String(value ?? "")}
                          onChange={(event) => update(event.target.value)}
                          aria-describedby={`${id}-hint`}
                        />
                      ) : (
                        <input
                          id={id}
                          className="field"
                          type={
                            field.type === "secret"
                              ? "password"
                              : field.type === "number"
                                ? "number"
                                : "text"
                          }
                          disabled={disabled}
                          autoComplete="off"
                          min={field.min}
                          step={field.step || 1}
                          value={String(value ?? "")}
                          onChange={(event) =>
                            update(
                              field.type === "number"
                                ? Number(event.target.value)
                                : event.target.value,
                            )
                          }
                          placeholder={
                            field.type === "secret"
                              ? "保留脱敏值表示不修改"
                              : undefined
                          }
                          aria-describedby={
                            field.hint ? `${id}-hint` : undefined
                          }
                        />
                      )}
                      {field.hint && <p id={`${id}-hint`}>{field.hint}</p>}
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </fieldset>
      </form>
      {page === "platform" && (
        <nav className="platform-category-grid" aria-label="平台配置分类">
          {SETTINGS_PAGES.map((item) => (
            <button
              type="button"
              key={item.id}
              className="platform-category"
              onClick={() => navigate(item.id)}
            >
              <span>
                <b>{item.label}</b>
                <small>{item.description}</small>
              </span>
              <ArrowUpRight size={17} />
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}
