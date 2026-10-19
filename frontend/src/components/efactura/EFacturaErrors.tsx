/** ANAF's own messages on a submission, as ANAF wrote them (sanitized by the server). */
export const EFacturaErrors = ({ errors, title = "Erorile ANAF" }: {
  readonly errors: ReadonlyArray<string>
  readonly title?: string
}) => errors.length === 0
  ? null
  : <div className="alert" role="note">
    <strong>{title}</strong>
    <ul className="m-0 mt-1 grid gap-1 pl-5">{errors.map((error, index) => <li key={`${String(index)}:${error}`}>{error}</li>)}</ul>
  </div>
