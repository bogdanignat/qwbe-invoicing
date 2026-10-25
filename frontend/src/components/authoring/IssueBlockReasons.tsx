/** The id the issue button points `aria-describedby` at while it is closed. */
export const ISSUE_BLOCK_REASONS_ID = "invoice-issue-block-reasons"

/**
 * Why "Emite factura" is closed, right under it; nothing at all while it is
 * open. It is the button's description, not a live region: the notes it
 * repeats are already announced where they stand on the page.
 */
export const IssueBlockReasons = ({ reasons }: { readonly reasons: ReadonlyArray<string> }) =>
  reasons.length === 0 ? null
    : <div className="status-note warning" id={ISSUE_BLOCK_REASONS_ID}>
      <ul className="m-0 grid list-none gap-1 p-0">{reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
    </div>
