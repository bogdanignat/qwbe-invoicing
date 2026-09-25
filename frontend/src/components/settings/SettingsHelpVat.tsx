/**
 * The VAT half of the field guide. It is kept apart from the identity half
 * because it states the one rule the screen cannot enforce: which rate an
 * operation actually falls under is a fiscal judgement, not a setting.
 */
export const SettingsHelpVat = () => <>
  <section className="settings-help-vat">
    <h3>Configurația TVA</h3>
    <dl>
      <div><dt>Plătitoare de TVA</dt><dd>Regimul este ales explicit din această bifă. Forma în care introduci CUI-ul nu îl schimbă.</dd></div>
      <div><dt>Cote și cod TVA</dt><dd>Nu se completează aici: alegerea regimului scrie configurația standard, iar renunțarea scrie scutirea conform art. 310.</dd></div>
      <div className="help-highlight"><dt>Schimbarea regimului se aplică de la</dt><dd>Configurația este aleasă după <strong>data emiterii facturii</strong>, nu după ziua în care salvezi setările. O poți programa din timp: vechea cotă rămâne valabilă până în ziua precedentă. Facturile deja emise nu se modifică, iar liniile existente într-un draft își păstrează cota și primesc un avertisment.</dd></div>
      <div><dt>Istoric regim TVA</dt><dd>Perioadele trecute sunt afișate doar pentru consultare. Se modifică numai regimul curent, printr-o schimbare cu dată de aplicare.</dd></div>
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
</>
