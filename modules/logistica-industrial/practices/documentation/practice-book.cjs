'use strict';
// Lazy provider entry; these are source requirements, not runnable scenarios.
module.exports=require('./source-book-adapter.cjs').createBook(require('../data/source-practices.json'),'practice');
