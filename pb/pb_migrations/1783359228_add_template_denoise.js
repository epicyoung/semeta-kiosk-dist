/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_184785686")

  // add field — denoise override per-template (unset = 0 = pakai default global kiosk)
  collection.fields.add(new Field({
    "help": "",
    "hidden": false,
    "id": "number2751146253",
    "max": null,
    "min": null,
    "name": "denoise",
    "onlyInt": false,
    "presentable": false,
    "required": false,
    "system": false,
    "type": "number"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_184785686")

  // remove field
  collection.fields.removeById("number2751146253")

  return app.save(collection)
})
