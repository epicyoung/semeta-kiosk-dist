/// <reference path="../pb_data/types.d.ts" />
// Engine 'api' (Nano Banana Pro) — field per-template buat prompt multi-referensi + input tamu.
//
// api_model    key ke whitelist Worker. URL FAL asli TIDAK pernah disimpen di sini maupun di
//              kiosk — kalau kiosk bisa nentuin URL, Worker bakal nempelin FAL_API_KEY ke
//              server siapa pun yang diminta. Lihat MODEL_ENDPOINTS di worker/src/provider.ts.
// reference    gambar BG (mis. halte Tosari) yang ikut ke image_urls SEBELUM foto tamu.
//              Niru pola 'overlay': file field sendiri, bukan numpang thumbnail (sync-route
//              flatten thumbnail ke JPEG putih). maxSelect 3 = cap yang sama dgn sidecar.
// input_label  ADA ⇒ screen nameinput muncul dan isinya nempel di {input}. Kosong ⇒ dilewat.
// aspect_ratio enum FAL; kosong ⇒ biarin FAL yang mutusin.
// billing_id   UUID row `templates` di SUPABASE buat nagih token. RPC deduct_token nerima
//              `p_template_id uuid` sedangkan id PocketBase itu string 15-char, jadi tanpa ini
//              generate mati di RPC (400) sebelum nyentuh FAL. Harga tetep dari Supabase.
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_184785686")

  collection.fields.add(new Field({
    "autogeneratePattern": "",
    "hidden": false,
    "id": "text7868000001",
    "max": 0,
    "min": 0,
    "name": "api_model",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": false,
    "system": false,
    "type": "text"
  }))

  collection.fields.add(new Field({
    "hidden": false,
    "id": "file7868000002",
    "maxSelect": 3,
    "maxSize": 5242880,
    "mimeTypes": ["image/jpeg", "image/png", "image/webp"],
    "name": "reference",
    "presentable": false,
    "protected": false,
    "required": false,
    "system": false,
    "thumbs": [],
    "type": "file"
  }))

  collection.fields.add(new Field({
    "autogeneratePattern": "",
    "hidden": false,
    "id": "text7868000003",
    "max": 40,
    "min": 0,
    "name": "input_label",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": false,
    "system": false,
    "type": "text"
  }))

  collection.fields.add(new Field({
    "autogeneratePattern": "",
    "hidden": false,
    "id": "text7868000005",
    "max": 36,
    "min": 0,
    "name": "billing_id",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": false,
    "system": false,
    "type": "text"
  }))

  collection.fields.add(new Field({
    "autogeneratePattern": "",
    "hidden": false,
    "id": "text7868000004",
    "max": 0,
    "min": 0,
    "name": "aspect_ratio",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": false,
    "system": false,
    "type": "text"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_184785686")

  collection.fields.removeById("text7868000001")
  collection.fields.removeById("file7868000002")
  collection.fields.removeById("text7868000003")
  collection.fields.removeById("text7868000004")
  collection.fields.removeById("text7868000005")

  return app.save(collection)
})
