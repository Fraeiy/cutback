export function Brand({ large = false }: { large?: boolean }) {
  return (
    <div className={large ? "brand brand-large" : "brand"}>
      <svg className="brand-mark" viewBox="0 0 24 24" aria-hidden="true">
        <path fill="#5EE6C4" d="M3 4.5h13.2L7.2 12H3z" />
        <path fill="#5EE6C4" d="M21 19.5H7.8L16.8 12H21z" />
      </svg>
      <strong>Cutback</strong>
    </div>
  )
}
