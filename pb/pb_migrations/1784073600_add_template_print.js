/// <reference path="../pb_data/types.d.ts" />
// Photo Print engine — field per-template: jumlah jepretan, ukuran cetak, overlay PNG.
// Overlay TIDAK numpang field thumbnail (sync-route flatten alpha ke JPEG putih) —
// file field sendiri, config niru frames.image (PNG/webp, alpha utuh, 5MB).
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_184785686")

  // token_cost required=true di PB berarti NONZERO — template print (cost 0) bakal
  // ditolak 400 "cannot be blank" pas sync. Relax: kiosk gak pernah validasi client-side,
  // Worker deduct server-side dari datanya sendiri.
  const tokenCost = collection.fields.getById("number2049089950")
  if (tokenCost) tokenCost.required = false

  collection.fields.add(new Field({
    "hidden": false,
    "id": "number7841000001",
    "max": null,
    "min": null,
    "name": "shot_count",
    "onlyInt": true,
    "presentable": false,
    "required": false,
    "system": false,
    "type": "number"
  }))

  collection.fields.add(new Field({
    "autogeneratePattern": "",
    "hidden": false,
    "id": "text7841000002",
    "max": 0,
    "min": 0,
    "name": "print_size",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": false,
    "system": false,
    "type": "text"
  }))

  collection.fields.add(new Field({
    "hidden": false,
    "id": "file7841000003",
    "maxSelect": 1,
    "maxSize": 5242880,
    "mimeTypes": ["image/png", "image/webp"],
    "name": "overlay",
    "presentable": false,
    "protected": false,
    "required": false,
    "system": false,
    "thumbs": [],
    "type": "file"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_184785686")

  const tokenCost = collection.fields.getById("number2049089950")
  if (tokenCost) tokenCost.required = true

  collection.fields.removeById("number7841000001")
  collection.fields.removeById("text7841000002")
  collection.fields.removeById("file7841000003")

  return app.save(collection)
})
