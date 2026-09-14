export function BrandLogo() {
  return (
    <span className="bd-brand" aria-label="BrainDance 脑力乐园">
      <svg aria-hidden="true" viewBox="0 0 56 56" width="44" height="44">
        <rect x="2" y="2" width="52" height="52" rx="18" fill="var(--bd-primary)" />
        <path
          d="M28 15c-5-7-15-2-13 5-8 3-6 15 1 16 0 8 10 10 12 4 2 6 12 4 12-4 7-1 9-13 1-16 2-7-8-12-13-5Z"
          fill="#fff"
        />
        <path
          d="M28 17v22M20 21c5-1 7 3 5 6m11-6c-5-1-7 3-5 6M18 32c3-3 7-1 7 3m13-3c-3-3-7-1-7 3"
          fill="none"
          stroke="var(--bd-primary)"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        <path d="m45 5 1.5 4.5L51 11l-4.5 1.5L45 17l-1.5-4.5L39 11l4.5-1.5Z" fill="#ffd56a" />
        <circle cx="20" cy="31" r="1.4" fill="var(--bd-primary)" />
        <circle cx="36" cy="31" r="1.4" fill="var(--bd-primary)" />
      </svg>
      <span>
        <strong>
          Brain<span>Dance</span>
        </strong>
        <small>让每一点进步，都被看见</small>
      </span>
    </span>
  );
}
