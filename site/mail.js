// Setzt die E-Mail-Adresse erst im Browser zusammen, damit sie nicht als Klartext oder mailto-Link
// im HTML steht (Schutz vor Adress-Scrapern). Ohne JavaScript bleibt die Schreibweise mit [at]/[dot].
for (const el of document.querySelectorAll("span.mail[data-u][data-d]")) {
  const rev = (s) => [...s].reverse().join("");
  const address = `${rev(el.dataset.u)}@${rev(el.dataset.d)}`;
  const link = document.createElement("a");
  link.href = `mailto:${address}`;
  link.textContent = address;
  el.replaceWith(link);
}
