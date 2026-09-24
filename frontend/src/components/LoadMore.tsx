import { Button } from "./Button.tsx"

interface LoadMoreProps {
  readonly visible: boolean
  readonly pending: boolean
  readonly onClick: () => void
}

export const LoadMore = ({ visible, pending, onClick }: LoadMoreProps) => visible
  ? <div className="load-more">
    <Button className="secondary" disabled={pending} onClick={onClick}>
      {pending ? "Se încarcă…" : "Încarcă mai multe"}
    </Button>
  </div>
  : null
