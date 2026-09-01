import { useRef } from "react"

export const SettingsHelpDialog = () => {
  const dialog = useRef<HTMLDialogElement>(null)
  return <>
    <button className="button secondary" type="button" aria-haspopup="dialog" onClick={() => { dialog.current?.showModal() }}><span aria-hidden="true">ⓘ</span> Ajutor pentru câmpuri</button>
    <dialog ref={dialog} className="settings-help-dialog" aria-labelledby="settings-help-title">
      <header><div><p className="eyebrow">Ghid de completare</p><h2 id="settings-help-title">Ce înseamnă câmpurile din „Date firmă”</h2></div><form method="dialog"><button className="dialog-close" type="submit" aria-label="Închide ghidul">×</button></form></header>
      <div className="settings-help-body">
        <section>
          <h3>Identificarea firmei</h3>
          <dl>
            <div><dt>CUI / identificator fiscal</dt><dd>Poate fi introdus cu sau fără prefixul „RO”. Prefixul trebuie să corespundă statutului TVA selectat, iar cifra de control este verificată la salvare.</dd></div>
            <div><dt>Județ și cod poștal</dt><dd>Sunt opționale, dar completează adresa fiscală afișată în documentele emise.</dd></div>
          </dl>
        </section>
        <section>
          <h3>Valori implicite pentru facturi</h3>
          <dl>
            <div><dt>Monedă implicită</dt><dd>În această versiune facturile sunt emise în RON, de aceea moneda este fixă.</dd></div>
            <div><dt>Termen de plată</dt><dd>Numărul de zile folosit pentru calcularea automată a scadenței atunci când nu alegi manual o dată.</dd></div>
            <div><dt>Serie implicită</dt><dd>Prefixul numărului facturii, de exemplu „QWBE 123”. Se aplică documentelor emise ulterior și nu renumerotează facturile existente.</dd></div>
          </dl>
        </section>
        <section className="settings-help-vat">
          <h3>Configurația TVA</h3>
          <dl>
            <div><dt>Plătitoare de TVA</dt><dd>Trebuie să corespundă CUI-ului: prefixul „RO” cere opțiunea bifată, iar CUI-ul fără „RO” cere opțiunea debifată.</dd></div>
            <div><dt>Cod TVA</dt><dd>Identificatorul tehnic al regimului: de regulă „RO_STANDARD” pentru TVA standard și „RO_NON_VAT” pentru neplătitoare. La o schimbare obișnuită de procent păstrezi „RO_STANDARD”.</dd></div>
            <div><dt>Cotă TVA</dt><dd>Procentul aplicat liniilor noi de factură care folosesc configurația valabilă la data emiterii.</dd></div>
            <div className="help-highlight"><dt>Noua configurație TVA valabilă de la</dt><dd>Configurația este aleasă după <strong>data emiterii facturii</strong>, nu după ziua în care salvezi setările. O poți programa din timp: vechea cotă rămâne valabilă până în ziua precedentă. Facturile deja emise nu se modifică, iar liniile existente într-un draft își păstrează cota și primesc un avertisment.</dd></div>
          </dl>
        </section>
        <section>
          <h3>Cote TVA folosite în România</h3>
          <dl>
            <div><dt>21% — cota standard</dt><dd>Se aplică operațiunilor taxabile care nu intră într-un regim redus sau de scutire.</dd></div>
            <div><dt>11% — cota redusă</dt><dd>Poate fi aplicabilă unor categorii speciale, precum alimente eligibile, medicamente, apă, cărți, cazare și servicii de restaurant/catering. Încadrarea exactă depinde de produs sau serviciu.</dd></div>
            <div><dt>9% — regim tranzitoriu special</dt><dd>La 1 septembrie 2026 mai poate fi aplicabilă numai anumitor locuințe care îndeplinesc condițiile legale, cu termen tranzitoriu până la 30 septembrie 2026. <strong>Nu este cota generală pentru alimente.</strong></dd></div>
          </dl>
          <p className="settings-help-note">Aplicația permite configurarea cotelor speciale, dar nu stabilește automat încadrarea fiscală. Operațiunile scutite nu trebuie tratate automat ca „TVA 0%”. Informațiile au fost verificate la 1 septembrie 2026 din Codul fiscal și materialele ANAF.</p>
        </section>
      </div>
      <form className="dialog-actions" method="dialog"><button className="button primary" type="submit">Am înțeles</button></form>
    </dialog>
  </>
}
