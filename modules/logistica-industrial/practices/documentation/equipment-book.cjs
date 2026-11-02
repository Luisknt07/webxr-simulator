'use strict';
// Lazy provider entry; never import this file from a cold resource catalogue.
module.exports=require('./source-book-adapter.cjs').createBook(require('../data/source-equipment.json'),'equipment');
