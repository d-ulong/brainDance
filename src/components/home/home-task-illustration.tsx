/** Theme-specific decorative art for the next-task card (non-interactive). */
export function HomeTaskIllustration() {
  return (
    <div className="bd-task-art" aria-hidden="true">
      <svg className="bd-task-art-space" viewBox="0 0 320 280" role="presentation">
        <defs>
          <linearGradient id="bd-space-planet" x2="0.9" y2="1">
            <stop stopColor="#bbf0ff" />
            <stop offset="0.5" stopColor="#54b6d6" />
            <stop offset="1" stopColor="#234369" />
          </linearGradient>
          <linearGradient id="bd-space-helmet" x2="1" y2="1">
            <stop stopColor="#d9f8ff" />
            <stop offset="1" stopColor="#6c9eba" />
          </linearGradient>
          <linearGradient id="bd-space-visor" x2="0.8" y2="1">
            <stop stopColor="#233d63" />
            <stop offset="1" stopColor="#091a32" />
          </linearGradient>
        </defs>
        <circle cx="160" cy="140" r="112" fill="none" stroke="#91dfee" opacity="0.2" strokeDasharray="3 8" />
        <ellipse
          cx="160"
          cy="150"
          rx="140"
          ry="70"
          fill="none"
          stroke="#79dcf5"
          opacity="0.2"
          transform="rotate(-28 160 150)"
        />
        <circle cx="244" cy="70" r="36" fill="url(#bd-space-planet)" />
        <ellipse
          cx="244"
          cy="70"
          rx="54"
          ry="12"
          fill="none"
          stroke="#d7f7ff"
          strokeWidth="5"
          transform="rotate(-25 244 70)"
        />
        <g transform="rotate(-12 134 157)">
          <rect x="79" y="144" width="112" height="77" rx="33" fill="#a8c8dc" />
          <rect x="95" y="159" width="81" height="57" rx="21" fill="#edf8f9" />
          <rect x="115" y="177" width="39" height="23" rx="6" fill="#163758" />
          <circle cx="125" cy="188" r="3" fill="#7ef0eb" />
          <path d="M136 188h10" stroke="#6d99ac" strokeWidth="3" />
          <ellipse cx="134" cy="127" rx="65" ry="58" fill="url(#bd-space-helmet)" />
          <rect x="84" y="92" width="101" height="67" rx="31" fill="url(#bd-space-visor)" />
          <path
            d="M99 105q26-16 54-5"
            fill="none"
            stroke="#fff"
            opacity="0.55"
            strokeWidth="5"
            strokeLinecap="round"
          />
          <circle cx="117" cy="132" r="5" fill="#8deaf0" />
          <circle cx="151" cy="132" r="5" fill="#8deaf0" />
          <path
            d="M128 142q7 6 13-1"
            fill="none"
            stroke="#8deaf0"
            strokeWidth="3"
            strokeLinecap="round"
          />
          <rect x="87" y="215" width="37" height="23" rx="10" fill="#d4e4eb" />
          <rect x="151" y="215" width="37" height="23" rx="10" fill="#d4e4eb" />
          <path
            d="M79 169q-38-2-33 28"
            fill="none"
            stroke="#d4e4eb"
            strokeWidth="20"
            strokeLinecap="round"
          />
          <path
            d="M188 170q22-3 22-25"
            fill="none"
            stroke="#d4e4eb"
            strokeWidth="20"
            strokeLinecap="round"
          />
          <rect x="192" y="122" width="45" height="29" rx="6" fill="#ffb873" transform="rotate(12 215 138)" />
        </g>
        <path d="m43 66 3 9 9 3-9 3-3 9-3-9-9-3 9-3Z" fill="#ffca91" />
        <circle cx="270" cy="207" r="4" fill="#8deaf0" />
        <circle cx="63" cy="231" r="2" fill="#b9f1ff" />
      </svg>
      <svg className="bd-task-art-candy" viewBox="0 0 320 280" role="presentation">
        <defs>
          <linearGradient id="bd-candy-mallow" x2="0.8" y2="1">
            <stop stopColor="#fffdf4" />
            <stop offset="0.6" stopColor="#ffeddc" />
            <stop offset="1" stopColor="#efb9b8" />
          </linearGradient>
        </defs>
        <ellipse cx="159" cy="242" rx="95" ry="16" fill="#d7987e" opacity="0.16" />
        <g transform="rotate(12 232 70)">
          <path d="m205 61-25-11 4 36 24-9m50-16 25-11-4 36-24-9" fill="#80c6b5" />
          <rect x="204" y="48" width="57" height="42" rx="17" fill="#b3e5d2" />
          <path d="m218 53 13 31m3-32 12 26" stroke="#e9fff4" strokeWidth="5" />
        </g>
        <g transform="rotate(-8 139 160)">
          <rect
            x="63"
            y="91"
            width="146"
            height="141"
            rx="56"
            fill="url(#bd-candy-mallow)"
            stroke="#f6d4ca"
            strokeWidth="2"
          />
          <path
            d="M85 112q34-22 76-12"
            fill="none"
            stroke="#fff"
            strokeWidth="10"
            strokeLinecap="round"
            opacity="0.8"
          />
          <ellipse cx="103" cy="166" rx="12" ry="7" fill="#ed9fa5" opacity="0.6" />
          <ellipse cx="170" cy="166" rx="12" ry="7" fill="#ed9fa5" opacity="0.6" />
          <circle cx="114" cy="152" r="5" fill="#644851" />
          <circle cx="159" cy="152" r="5" fill="#644851" />
          <path
            d="M130 167q8 9 16-1"
            fill="none"
            stroke="#644851"
            strokeWidth="3"
            strokeLinecap="round"
          />
          <path d="M90 230h24m47 0h22" stroke="#e1aaa3" strokeWidth="17" strokeLinecap="round" />
          <path
            d="M68 180q-21 7-14 20m149-20q22 4 17-15"
            fill="none"
            stroke="#f1d3c7"
            strokeWidth="15"
            strokeLinecap="round"
          />
        </g>
        <g transform="rotate(12 221 207)">
          <rect x="187" y="176" width="72" height="58" rx="12" fill="#dd9665" />
          <rect
            x="191"
            y="177"
            width="64"
            height="48"
            rx="10"
            fill="#f3c897"
            stroke="#bd8059"
            strokeWidth="2"
            strokeDasharray="2 5"
          />
          <path
            d="M207 190h29m-29 10h24m-24 10h16"
            stroke="#d49b6e"
            strokeWidth="3"
            strokeLinecap="round"
          />
        </g>
        <path d="m50 73 4 9 10 2-8 6 1 10-8-6-9 4 4-10-6-7 10 1Z" fill="#ecb65e" />
        <path
          d="m260 123 6 9m-220 91 9-5m134-174 8 5"
          stroke="#e791a8"
          strokeWidth="6"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}
