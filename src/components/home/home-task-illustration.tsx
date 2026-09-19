/** Theme-specific decorative art for the next-task card (non-interactive). */
export function HomeTaskIllustration() {
  return (
    <div className="bd-task-art" aria-hidden="true">
      <svg className="bd-task-art-space" viewBox="0 0 320 280" role="presentation">
        <circle cx="160" cy="140" r="112" fill="none" stroke="#91dfee" opacity="0.25" strokeDasharray="3 8" />
        <circle cx="244" cy="70" r="36" fill="#54b6d6" />
        <ellipse cx="244" cy="70" rx="54" ry="12" fill="none" stroke="#d7f7ff" strokeWidth="4" />
        <rect x="79" y="144" width="112" height="77" rx="33" fill="#6c9eba" />
        <rect x="96" y="118" width="78" height="58" rx="28" fill="#d9f8ff" />
        <ellipse cx="135" cy="148" rx="22" ry="16" fill="#233d63" />
      </svg>
      <svg className="bd-task-art-candy" viewBox="0 0 320 280" role="presentation">
        <ellipse cx="159" cy="242" rx="95" ry="16" fill="#d7987e" opacity="0.16" />
        <rect x="63" y="91" width="146" height="141" rx="56" fill="#ffeddc" stroke="#f6d4ca" strokeWidth="2" />
        <ellipse cx="103" cy="166" rx="12" ry="7" fill="#c8507b" opacity="0.35" />
        <ellipse cx="185" cy="158" rx="12" ry="7" fill="#c8507b" opacity="0.35" />
        <path d="M118 178q20 14 44 8" fill="none" stroke="#c8507b" strokeWidth="4" strokeLinecap="round" />
      </svg>
    </div>
  );
}
