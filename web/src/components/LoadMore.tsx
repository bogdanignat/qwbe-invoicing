import { Button } from "./ui/Button.tsx"

export const LoadMore = ({ visible, pending, onClick }: { readonly visible: boolean; readonly pending: boolean; readonly onClick: () => void }) =>
  visible ? <div className="load-more"><Button variant="secondary" disabled={pending} onClick={onClick}>{pending ? "Se încarcă…" : "Încarcă mai multe"}</Button></div> : null
