export function rowHtml(
  id = "000123",
  locations = "Persh:99,Persh:100,Persh:101",
) {
  return `<tr><td><a href="/shipments/edit">Edit</a></td><td>${id}</td><td>${locations}</td></tr>`;
}
export function tableHtml(
  rows = rowHtml(),
  field = "shipment_id",
  direction = "asc",
) {
  return `<table class="grid-table"><thead><tr><th>Actions</th><th class="active_sort_tag"><a href="?sort_key=${field}">Shipment</a><img src="/sort_${direction}.png" alt="Sort"></th><th><a href="?sort_key=integrations.preferred_locations.inbound">Preferred Locations.Inbound</a></th></tr></thead><tbody>${rows}</tbody></table>`;
}
