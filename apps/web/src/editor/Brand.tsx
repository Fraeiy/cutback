export function Brand({ large = false }: { large?: boolean }) {
  return (
    <div className={large ? "brand brand-large" : "brand"}>
      <svg className="brand-mark" viewBox="0 0 24 24" aria-hidden="true">
        <g fill="#0c4a40" transform="translate(1.15 1.4)">
          <path d="M3 4.5h13.2L7.2 12H3z" />
          <path d="M21 19.5H7.8L16.8 12H21z" />
        </g>
        <path fill="#5EE6C4" d="M3 4.5h13.2L7.2 12H3z" />
        <path fill="#b8fff0" d="M21 19.5H7.8L16.8 12H21z" />
      </svg>
      <strong>Cutback</strong>
    </div>
  )
}
