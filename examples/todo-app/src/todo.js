'use strict';
function createStore() {
  const items = [];
  function add(title) {
    const item = { title: String(title), done: false };
    items.push(item);
    return item;
  }
  function list() { return [...items]; }
  function complete(index) { if (items[index]) items[index].done = true; }
  return { add, list, complete };
}
module.exports = { createStore };
