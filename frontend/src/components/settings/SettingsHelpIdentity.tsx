/**
 * The identity half of the field guide: what each legal field means and when it
 * becomes mandatory. The sentences are the legacy dialog's, verified against the
 * Codul fiscal and ANAF materials on 1 September 2026.
 */
export const SettingsHelpIdentity = () => <>
  <section>
    <h3>Identificarea firmei</h3>
    <dl>
      <div><dt>CUI / identificator fiscal</dt><dd>Poate fi introdus cu sau fără prefixul „RO”. Prefixul introdus este eliminat, nu modifică regimul TVA, iar cifra de control este verificată la salvare.</dd></div>
      <div><dt>Formă juridică</dt><dd>Alege explicit SRL sau PFA. Aplicația nu presupune automat o formă juridică pentru un profil nou.</dd></div>
      <div><dt>Nr. Registrul Comerțului</dt><dd>Acceptă formatul clasic, de exemplu „J40/1234/2020”, sau identificatorul nou format din J/F și 13 cifre. Poți salva temporar câmpul gol, dar emiterea cere această informație.</dd></div>
      <div><dt>Capital social</dt><dd>Sumă în RON, cu maximum 18 cifre întregi și două zecimale. Este necesară la emitere pentru SRL, nu și pentru PFA.</dd></div>
      <div><dt>IBAN și bancă</dt><dd>Sunt opționale. Spațiile din IBAN sunt eliminate la salvare, literele devin majuscule și cifra de control este verificată.</dd></div>
      <div><dt>Județ și cod poștal</dt><dd>Județul este obligatoriu, codul poștal este opțional; ambele completează adresa fiscală afișată în documentele emise.</dd></div>
    </dl>
  </section>
  <section>
    <h3>Brand documente</h3>
    <dl>
      <div><dt>Text de brand</dt><dd>O linie de maximum 80 de caractere, tipărită lângă datele firmei. Câmpul gol înseamnă „fără text de brand”.</dd></div>
      <div><dt>Siglă</dt><dd>PNG sau JPEG, maximum 256 KiB, 2048 px pe axă și 4 megapixeli. Imaginea este recodificată PNG la salvare. Un fișier respins trebuie înlocuit sau abandonat înainte de salvare.</dd></div>
    </dl>
  </section>
  <section>
    <h3>Valori implicite pentru facturi</h3>
    <dl>
      <div><dt>Monedă implicită</dt><dd>În această versiune facturile sunt emise în RON, de aceea moneda este fixă.</dd></div>
      <div><dt>Termen de plată</dt><dd>Numărul de zile folosit pentru calcularea automată a scadenței atunci când nu alegi manual o dată.</dd></div>
    </dl>
  </section>
  <section>
    <h3>Serii de documente</h3>
    <dl>
      <div><dt>Tip document</dt><dd>Seriile pentru Factură și Proformă sunt configurate separat. La crearea unei facturi poți alege numai o serie de tip Factură.</dd></div>
      <div><dt>Serie</dt><dd>Prefixul numărului documentului, de exemplu „QWBE” în „QWBE 123”. Configurarea este doar de adăugare: seriile existente rămân în listă.</dd></div>
      <div><dt>Serie fixată în draft</dt><dd>Seria aleasă se salvează în draft și nu se schimbă la emitere. Emiterea alocă numai următorul număr fiscal din acea serie.</dd></div>
    </dl>
  </section>
</>
