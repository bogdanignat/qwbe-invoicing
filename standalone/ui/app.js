import { ApiError, createApiClient } from "/assets/api-client.js"

const app = document.querySelector("#app")
const toast = document.querySelector("#toast")
let requestVersion = 0
let unlocked = false

const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
})[character])

const field = (form, name) => String(new FormData(form).get(name) ?? "").trim()
const today = () => {
  const date = new Date()
  const twoDigits = (value) => String(value).padStart(2, "0")
  return `${date.getFullYear()}-${twoDigits(date.getMonth() + 1)}-${twoDigits(date.getDate())}`
}
const money = (value, currency = "RON") => `${escapeHtml(value)} ${escapeHtml(currency)}`
const route = () => location.hash.slice(1) || (unlocked ? "/invoices" : "/unlock")

const errors = {
  customer_has_open_drafts: "Clientul are drafturi deschise.",
  invoice_already_sent_to_anaf: "Factura a fost deja transmisă în RO e-Factura și nu poate fi ștearsă.",
  invoice_has_corrections: "Factura are documente de corecție și nu poate fi ștearsă.",
  invoice_has_payments: "Factura are plăți înregistrate și nu poate fi ștearsă.",
  only_last_invoice_can_be_deleted: "Poți șterge doar ultima factură emisă din serie.",
}

const client = createApiClient({
  onUnauthorized: () => {
    unlocked = false
    location.hash = "#/unlock"
  },
})

const showToast = (message) => {
  toast.textContent = message
  toast.hidden = false
  window.setTimeout(() => { toast.hidden = true }, 3200)
}

const errorMarkup = (error) => {
  const message = error instanceof ApiError && error.code !== undefined ? errors[error.code] ?? error.message : error instanceof Error ? error.message : "A apărut o eroare neașteptată."
  const issues = error instanceof ApiError ? error.issues : []
  return `<div class="alert" role="alert" tabindex="-1"><strong>Nu am putut finaliza operația.</strong><p>${escapeHtml(message)}</p>${issues.length > 1 ? `<ul>${issues.map((issue) => `<li>${escapeHtml(issue)}</li>`).join("")}</ul>` : ""}</div>`
}

const page = (title, eyebrow, body, actions = "") => `
  <header class="page-header">
    <div><p class="eyebrow">${escapeHtml(eyebrow)}</p><h1 tabindex="-1">${escapeHtml(title)}</h1></div>
    <div class="page-actions">${actions}</div>
  </header>
  ${body}`

const setContent = (markup, focus = true) => {
  app.innerHTML = markup
  document.body.classList.toggle("locked", !unlocked)
  const section = route().split("/")[1] || ""
  document.querySelectorAll("[data-nav]").forEach((link) => link.toggleAttribute("aria-current", link.dataset.nav === section))
  if (focus) app.querySelector("h1")?.focus()
}

const loading = (label = "Se încarcă…") => setContent(`<div class="center-state"><span class="spinner" aria-hidden="true"></span><p>${escapeHtml(label)}</p></div>`, false)

const load = async (operation, render) => {
  const version = ++requestVersion
  loading()
  try {
    const result = await operation()
    if (version === requestVersion) setContent(render(result))
  } catch (error) {
    if (version === requestVersion) setContent(page("Ceva nu a mers", "Eroare", errorMarkup(error)))
  }
}

const unlockView = (error = "") => page("Bine ai revenit", "QWBE Invoicing", `
  <section class="unlock-card">
    <div class="unlock-icon" aria-hidden="true">⌁</div>
    <p>Introdu tokenul API local pentru această sesiune. Nu îl salvăm în browser, URL sau storage.</p>
    ${error}
    <form data-form="unlock">
      <label for="api-token">Token API</label>
      <input id="api-token" name="token" type="password" autocomplete="off" required autofocus>
      <button class="button primary wide" type="submit">Deblochează aplicația</button>
    </form>
  </section>`)

const addressFields = (prefix = "", values = {}) => `
  <div class="form-grid two">
    <label>Denumire legală<input name="${prefix}legalName" value="${escapeHtml(values.legalName)}" required></label>
    <label>CUI / identificator fiscal<input name="${prefix}taxIdentifier" value="${escapeHtml(values.taxIdentifier)}" required></label>
    <label>Țară<input name="${prefix}countryCode" value="${escapeHtml(values.address?.countryCode ?? "RO")}" maxlength="2" required></label>
    <label>Localitate<input name="${prefix}city" value="${escapeHtml(values.address?.city)}" required></label>
    <label class="span-two">Adresă<input name="${prefix}street" value="${escapeHtml(values.address?.street)}" required></label>
    <label>Județ<input name="${prefix}county" value="${escapeHtml(values.address?.county)}"></label>
    <label>Cod poștal<input name="${prefix}postalCode" value="${escapeHtml(values.address?.postalCode)}"></label>
  </div>`

const customerView = (customers) => page("Clienți", "Registru comercial", `
  <div class="split-layout">
    <section class="card">
      <div class="section-heading"><div><h2>Registrul de clienți</h2><p>Maximum 100 de clienți activi, ordonați alfabetic.</p></div><span class="count">${customers.length}</span></div>
      ${customers.length === 0 ? `<div class="empty"><strong>Niciun client încă</strong><p>Adaugă primul client folosind formularul alăturat.</p></div>` : `
        <div class="table-wrap"><table><caption class="sr-only">Clienți activi</caption><thead><tr><th>Client</th><th>CUI</th><th>Localitate</th><th><span class="sr-only">Acțiuni</span></th></tr></thead><tbody>
          ${customers.map((customer) => `<tr><td><strong>${escapeHtml(customer.legalName)}</strong><small>${escapeHtml(customer.address.street)}</small></td><td>${escapeHtml(customer.taxIdentifier)}</td><td>${escapeHtml(customer.address.city)}</td><td class="row-actions"><button class="button danger ghost small" data-action="delete-customer" data-id="${escapeHtml(customer.id)}" data-name="${escapeHtml(customer.legalName)}">Șterge</button></td></tr>`).join("")}
        </tbody></table></div>`}
    </section>
    <section class="card sticky-card"><h2>Client nou</h2><p>Datele sunt copiate în snapshot-ul fiscal la emiterea facturii.</p>
      <form data-form="customer">${addressFields()}<button class="button primary" type="submit">Salvează clientul</button></form>
    </section>
  </div>`, `<a class="button secondary" href="#/invoices/new">Factură nouă</a>`)

const invoiceListView = (invoices) => page("Facturi", "Documente emise", `
  <section class="card">
    <div class="section-heading"><div><h2>Ultimele facturi</h2><p>Snapshot-uri fiscale imuabile, cele mai recente primele.</p></div><span class="count">${invoices.length}</span></div>
    ${invoices.length === 0 ? `<div class="empty"><strong>Nicio factură emisă</strong><p>Creează un draft și emite prima factură.</p><a class="button primary" href="#/invoices/new">Creează factura</a></div>` : `
      <div class="table-wrap"><table><caption class="sr-only">Facturi emise</caption><thead><tr><th>Număr</th><th>Client</th><th>Data</th><th>Total</th><th>Status e-Factura</th></tr></thead><tbody>
        ${invoices.map((invoice) => `<tr class="clickable"><td><a href="#/invoices/${encodeURIComponent(invoice.id)}"><strong>${escapeHtml(invoice.series)} ${escapeHtml(invoice.number)}</strong></a></td><td>${escapeHtml(invoice.customer.legalName)}</td><td>${escapeHtml(invoice.issueDate)}</td><td>${money(invoice.totalIncludingTax, invoice.currency)}</td><td><span class="badge ${invoice.eFacturaStatus === "not_sent" ? "muted" : "positive"}">${escapeHtml(invoice.eFacturaStatus)}</span></td></tr>`).join("")}
      </tbody></table></div>`}
  </section>`, `<a class="button primary" href="#/invoices/new">+ Factură nouă</a>`)

const newInvoiceView = (customers) => page("Factură nouă", "Draft fiscal", customers.length === 0 ? `
  <section class="card empty"><strong>Ai nevoie de un client activ.</strong><p>Adaugă clientul înainte să creezi factura.</p><a class="button primary" href="#/customers">Adaugă client</a></section>` : `
  <section class="card form-card"><form data-form="draft">
    <div class="form-grid two">
      <label class="span-two">Client<select name="customerId" required><option value="">Alege clientul</option>${customers.map((customer) => `<option value="${escapeHtml(customer.id)}">${escapeHtml(customer.legalName)} — ${escapeHtml(customer.taxIdentifier)}</option>`).join("")}</select></label>
      <label>Data emiterii<input name="issueDate" type="date" value="${today()}" required></label>
      <label>Data scadenței <span class="optional">opțional</span><input name="dueDate" type="date"></label>
      <label>Moneda<input name="currency" value="RON" maxlength="3" required></label>
    </div>
    <div class="form-actions"><a class="button ghost" href="#/invoices">Renunță</a><button class="button primary" type="submit">Creează draftul</button></div>
  </form></section>`)

const draftView = (draft) => page("Draft factură", `Scadență ${draft.dueDate}`, `
  <div class="split-layout invoice-layout">
    <section class="card">
      <div class="section-heading"><div><h2>Linii factură</h2><p>Calculele de TVA și totalurile sunt făcute exclusiv de server.</p></div><span class="badge muted">${escapeHtml(draft.status)}</span></div>
      ${draft.lines.length === 0 ? `<div class="empty compact"><strong>Draftul nu are linii.</strong><p>Adaugă cel puțin o linie pentru a-l putea emite.</p></div>` : `<div class="table-wrap"><table><caption class="sr-only">Liniile draftului</caption><thead><tr><th>Descriere</th><th>Cant.</th><th>Preț</th><th>TVA</th><th>Total</th></tr></thead><tbody>${draft.lines.map((line) => `<tr><td>${escapeHtml(line.description)}</td><td>${escapeHtml(line.quantity)}</td><td>${money(line.unitPrice, draft.currency)}</td><td>${escapeHtml(line.taxRate)}%</td><td>${money(line.totalIncludingTax, draft.currency)}</td></tr>`).join("")}</tbody></table></div>`}
      <form data-form="line" data-draft-id="${escapeHtml(draft.id)}" class="inline-form">
        <label>Descriere<input name="description" required></label><label>Cantitate<input name="quantity" inputmode="decimal" value="1" required></label><label>Preț unitar<input name="unitPrice" inputmode="decimal" required></label><label>Cod TVA<input name="taxCode" value="RO_STANDARD" required></label><button class="button secondary" type="submit">Adaugă linia</button>
      </form>
    </section>
    <aside class="card sticky-card summary-card"><h2>Sumar draft</h2><dl><div><dt>Data emiterii</dt><dd>${escapeHtml(draft.issueDate)}</dd></div><div><dt>Scadență</dt><dd>${escapeHtml(draft.dueDate)}</dd></div><div><dt>Monedă</dt><dd>${escapeHtml(draft.currency)}</dd></div><div><dt>Linii</dt><dd>${draft.lines.length}</dd></div></dl><button class="button primary wide" data-action="issue" data-id="${escapeHtml(draft.id)}" ${draft.lines.length === 0 ? "disabled" : ""}>Emite factura</button><p class="hint">Emiterea alocă seria și numărul fiscal.</p></aside>
  </div>`)

const invoiceView = (invoice) => page(`Factura ${invoice.series} ${invoice.number}`, `Emisă la ${invoice.issueDate}`, `
  <div class="invoice-document card">
    <div class="invoice-parties"><section><p class="eyebrow">Furnizor</p><h2>${escapeHtml(invoice.issuer.legalName)}</h2><p>${escapeHtml(invoice.issuer.taxIdentifier)}<br>${escapeHtml(invoice.issuer.address.street)}, ${escapeHtml(invoice.issuer.address.city)}</p></section><section><p class="eyebrow">Client</p><h2>${escapeHtml(invoice.customer.legalName)}</h2><p>${escapeHtml(invoice.customer.taxIdentifier)}<br>${escapeHtml(invoice.customer.address.street)}, ${escapeHtml(invoice.customer.address.city)}</p></section></div>
    <div class="table-wrap"><table><caption class="sr-only">Linii factură</caption><thead><tr><th>Descriere</th><th>Cantitate</th><th>Preț unitar</th><th>TVA</th><th>Total</th></tr></thead><tbody>${invoice.lines.map((line) => `<tr><td>${escapeHtml(line.description)}</td><td>${escapeHtml(line.quantity)}</td><td>${money(line.unitPrice, invoice.currency)}</td><td>${escapeHtml(line.taxRate)}%</td><td>${money(line.totalIncludingTax, invoice.currency)}</td></tr>`).join("")}</tbody></table></div>
    <div class="invoice-bottom"><dl><div><dt>Subtotal</dt><dd>${money(invoice.totalExcludingTax, invoice.currency)}</dd></div><div><dt>TVA</dt><dd>${money(invoice.taxTotal, invoice.currency)}</dd></div><div class="grand-total"><dt>Total</dt><dd>${money(invoice.totalIncludingTax, invoice.currency)}</dd></div></dl></div>
  </div>`, `<button class="button secondary" data-action="download-pdf" data-id="${escapeHtml(invoice.id)}" data-number="${escapeHtml(`${invoice.series}-${invoice.number}`)}">Descarcă PDF</button><button class="button danger ghost" data-action="delete-invoice" data-id="${escapeHtml(invoice.id)}">Șterge factura</button>`)

const settingsView = (issuer) => page("Date firmă", "Configurare emitent", `
  <section class="card form-card"><form data-form="issuer">
    ${addressFields("", issuer ?? {})}
    <hr><div class="form-grid two">
      <label>Monedă implicită<input name="defaultCurrency" value="${escapeHtml(issuer?.defaultCurrency ?? "RON")}" required></label>
      <label>Termen de plată (zile)<input name="defaultPaymentTermDays" type="number" min="0" value="${escapeHtml(issuer?.defaultPaymentTermDays ?? 15)}" required></label>
      <label>Serie implicită<input name="defaultSeries" value="${escapeHtml(issuer?.defaultSeries ?? "QWBE")}" required></label>
      <label>Cod TVA<input name="taxCode" value="${escapeHtml(issuer?.taxConfigurations?.[0]?.code ?? "RO_STANDARD")}" required></label>
      <label>Cotă TVA (%)<input name="taxRate" inputmode="decimal" value="${escapeHtml(issuer?.taxConfigurations?.[0]?.rate ?? "21.00")}" required></label>
      <label>TVA valabil de la<input name="taxEffectiveFrom" type="date" value="${escapeHtml(issuer?.taxConfigurations?.[0]?.effectiveFrom ?? today())}" required></label>
    </div><div class="form-actions"><button class="button primary" type="submit">Salvează datele firmei</button></div>
  </form></section>`)

const navigate = async () => {
  if (!unlocked && route() !== "/unlock") {
    location.hash = "#/unlock"
    return
  }
  const current = route()
  if (current === "/unlock") { setContent(unlockView()); return }
  if (current === "/customers") { await load(() => client.request("/api/customers"), customerView); return }
  if (current === "/invoices") { await load(() => client.request("/api/invoices"), invoiceListView); return }
  if (current === "/invoices/new") { await load(() => client.request("/api/customers"), newInvoiceView); return }
  if (current === "/settings") {
    await load(async () => { try { return await client.request("/api/issuer") } catch (error) { if (error instanceof ApiError && error.status === 404) return undefined; throw error } }, settingsView)
    return
  }
  const draft = /^\/drafts\/([^/]+)$/.exec(current)
  if (draft?.[1] !== undefined) { await load(() => client.request(`/api/drafts/${encodeURIComponent(draft[1])}`), draftView); return }
  const invoice = /^\/invoices\/([^/]+)$/.exec(current)
  if (invoice?.[1] !== undefined) { await load(() => client.request(`/api/invoices/${encodeURIComponent(invoice[1])}`), invoiceView); return }
  setContent(page("Pagina nu există", "404", `<section class="card empty"><p>Adresa nu corespunde unei pagini din aplicație.</p><a class="button primary" href="#/invoices">Înapoi la facturi</a></section>`))
}

app.addEventListener("submit", (event) => {
  const form = event.target
  if (!(form instanceof HTMLFormElement)) return
  event.preventDefault()
  void (async () => {
    form.querySelector(".alert")?.remove()
    const button = form.querySelector("button[type=submit]")
    if (button instanceof HTMLButtonElement) button.disabled = true
    try {
      if (form.dataset.form === "unlock") {
        client.setToken(field(form, "token")); form.reset()
        await client.request("/api/customers")
        unlocked = true
        location.hash = "#/invoices"
        return
      }
      if (form.dataset.form === "customer") {
        await client.request("/api/customers", { method: "POST", body: { legalName: field(form, "legalName"), taxIdentifier: field(form, "taxIdentifier"), address: { countryCode: field(form, "countryCode"), city: field(form, "city"), street: field(form, "street"), ...(field(form, "county") ? { county: field(form, "county") } : {}), ...(field(form, "postalCode") ? { postalCode: field(form, "postalCode") } : {}) } } })
        showToast("Clientul a fost adăugat."); await navigate(); return
      }
      if (form.dataset.form === "draft") {
        const draft = await client.request("/api/drafts", { method: "POST", body: { customerId: field(form, "customerId"), issueDate: field(form, "issueDate"), ...(field(form, "dueDate") ? { dueDate: field(form, "dueDate") } : {}), currency: field(form, "currency") } })
        location.hash = `#/drafts/${encodeURIComponent(draft.id)}`; return
      }
      if (form.dataset.form === "line") {
        await client.request(`/api/drafts/${encodeURIComponent(form.dataset.draftId)}/lines`, { method: "POST", body: { description: field(form, "description"), quantity: field(form, "quantity"), unitPrice: field(form, "unitPrice"), taxCode: field(form, "taxCode") } })
        showToast("Linia a fost adăugată."); await navigate(); return
      }
      if (form.dataset.form === "issuer") {
        await client.request("/api/issuer", { method: "PUT", body: { legalName: field(form, "legalName"), taxIdentifier: field(form, "taxIdentifier"), address: { countryCode: field(form, "countryCode"), city: field(form, "city"), street: field(form, "street"), ...(field(form, "county") ? { county: field(form, "county") } : {}), ...(field(form, "postalCode") ? { postalCode: field(form, "postalCode") } : {}) }, defaultCurrency: field(form, "defaultCurrency"), defaultPaymentTermDays: Number(field(form, "defaultPaymentTermDays")), defaultSeries: field(form, "defaultSeries"), taxConfigurations: [{ code: field(form, "taxCode"), category: "standard", rate: field(form, "taxRate"), effectiveFrom: field(form, "taxEffectiveFrom") }] } })
        showToast("Datele firmei au fost salvate."); await navigate()
      }
    } catch (error) {
      form.insertAdjacentHTML("afterbegin", errorMarkup(error))
      form.querySelector(".alert")?.focus()
    } finally {
      if (button instanceof HTMLButtonElement) button.disabled = false
    }
  })()
})

app.addEventListener("click", (event) => {
  const button = event.target instanceof Element ? event.target.closest("button[data-action]") : null
  if (!(button instanceof HTMLButtonElement)) return
  void (async () => {
    try {
      if (button.dataset.action === "delete-customer") {
        if (!window.confirm(`Ștergi clientul „${button.dataset.name}”? Facturile emise rămân neschimbate.`)) return
        await client.request(`/api/customers/${encodeURIComponent(button.dataset.id)}`, { method: "DELETE" })
        showToast("Clientul a fost șters din registrul activ."); await navigate()
      }
      if (button.dataset.action === "issue") {
        if (!window.confirm("Emiți factura și aloci numărul fiscal?")) return
        const invoice = await client.request(`/api/drafts/${encodeURIComponent(button.dataset.id)}/issue`, { method: "POST", body: {} })
        location.hash = `#/invoices/${encodeURIComponent(invoice.id)}`
      }
      if (button.dataset.action === "download-pdf") {
        await client.request(`/api/invoices/${encodeURIComponent(button.dataset.id)}/pdf`, { method: "POST", body: {} })
        const blob = await client.request(`/api/invoices/${encodeURIComponent(button.dataset.id)}/pdf`, { responseType: "blob" })
        const url = URL.createObjectURL(blob); const link = document.createElement("a")
        link.href = url; link.download = `factura-${button.dataset.number}.pdf`; link.click(); URL.revokeObjectURL(url)
      }
      if (button.dataset.action === "delete-invoice") {
        if (!window.confirm("Ștergi ultima factură din serie și eliberezi numărul? Operația este permisă doar înainte de trimiterea în RO e-Factura.")) return
        await client.request(`/api/invoices/${encodeURIComponent(button.dataset.id)}`, { method: "DELETE" })
        showToast("Factura a fost ștearsă, iar draftul a fost redeschis."); location.hash = "#/invoices"
      }
    } catch (error) {
      button.closest(".card")?.insertAdjacentHTML("afterbegin", errorMarkup(error))
      button.closest(".card")?.querySelector(".alert")?.focus()
    }
  })()
})

window.addEventListener("hashchange", () => { void navigate() })
void navigate()
