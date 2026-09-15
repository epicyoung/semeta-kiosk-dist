/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId('templates')
  if (!collection.fields.getByName('print_overlay')) {
    collection.fields.add(new Field({ name: 'print_overlay', type: 'file', maxSelect: 1, maxSize: 20971520, mimeTypes: ['image/png'], protected: false }))
  }
  if (!collection.fields.getByName('print_layout')) {
    collection.fields.add(new Field({ name: 'print_layout', type: 'json', maxSize: 10000 }))
  }
  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId('templates')
  collection.fields.removeByName('print_overlay')
  collection.fields.removeByName('print_layout')
  return app.save(collection)
})
