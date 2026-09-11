import type { IssuerBranding } from "../models.ts"

interface IssuerBrandProps {
  readonly branding: IssuerBranding | null
  readonly imageSrc?: string
}

export const IssuerBrand = ({ branding, imageSrc }: IssuerBrandProps) => {
  if (branding === null) return null
  return <div className="issuer-brand">
    {branding.image === null ? null : <img src={imageSrc ?? `data:image/png;base64,${branding.image.pngBase64}`} width={branding.image.width} height={branding.image.height} alt="Sigla emitentului" />}
    {branding.text === null ? null : <p>{branding.text}</p>}
  </div>
}
