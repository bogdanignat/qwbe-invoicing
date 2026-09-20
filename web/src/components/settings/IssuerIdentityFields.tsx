import type { useIssuerSettings } from "../../hooks/issuer-settings-hooks.ts"
import { romanianCuiPattern } from "../../lib/vat-defaults.ts"
import { ROMANIAN_COUNTIES } from "../../lib/romanian-counties.ts"

export const IssuerIdentityFields = ({ state }: { readonly state: ReturnType<typeof useIssuerSettings> }) => {
  const issuer = state.issuer
  return <><div className="form-grid two">
    <label>Denumire legală<input name="name" defaultValue={issuer?.name ?? ""} required /></label>
    <label>CUI / identificator fiscal<input name="fiscalIdentifier" defaultValue={state.fiscalIdentifier} pattern={romanianCuiPattern} maxLength={12} title="CUI românesc numeric; prefixul RO introdus este eliminat" aria-describedby="issuer-cui-hint" onInput={(event) => { state.normalizeFiscalIdentifier(event.currentTarget) }} required /></label>
    <label>Formă juridică<select name="legalForm" defaultValue={issuer?.legalForm ?? ""} required><option value="" disabled>Selectează forma juridică</option><option value="srl">SRL</option><option value="pfa">PFA</option></select></label>
    <label>Nr. Registrul Comerțului <span className="optional">necesar la emitere</span><input name="tradeRegistryNumber" defaultValue={issuer?.tradeRegistryNumber ?? ""} maxLength={32} placeholder="J2022000067070" /></label>
    <label>Țară<select name="countryCode" defaultValue="RO" required><option value="RO">România (RO)</option></select></label>
    <label>Localitate<input name="city" defaultValue={issuer?.address.city ?? ""} required /></label>
    <label className="span-two">Adresă<input name="street" defaultValue={issuer?.address.street ?? ""} required /></label>
    <label>Județ<select name="county" required value={state.county} onChange={(event) => { state.changeCounty(event.currentTarget.value) }}><option value="" disabled>Alege județul</option>{ROMANIAN_COUNTIES.map((county) => <option key={county.code} value={county.code}>{county.name}</option>)}</select></label>
    {state.sectorRequired ? <label>Sector<select name="sector" required value={state.sector ?? ""} onChange={(event) => { state.changeSector(event.currentTarget.value) }}><option value="" disabled>Alege sectorul</option>{[1, 2, 3, 4, 5, 6].map((sector) => <option key={sector} value={sector}>Sector {sector}</option>)}</select></label> : null}
    <label>Cod poștal<input name="postalCode" defaultValue={issuer?.address.postalCode ?? ""} /></label>
    <label>Capital social (RON) <span className="optional">necesar la emitere pentru SRL</span><input name="socialCapital" defaultValue={issuer?.socialCapital ?? ""} inputMode="decimal" maxLength={21} placeholder="200.00" /></label>
    <label>IBAN <span className="optional">opțional</span><input name="iban" defaultValue={issuer?.iban ?? ""} autoCapitalize="characters" spellCheck={false} /></label>
    <label className="span-two">Bancă <span className="optional">opțională</span><input name="bankName" defaultValue={issuer?.bankName ?? ""} /></label>
  </div><p className="hint" id="issuer-cui-hint">CUI-ul este salvat numeric; prefixul RO introdus este eliminat fără a modifica regimul TVA. Cifra de control este verificată la salvare.</p></>
}
