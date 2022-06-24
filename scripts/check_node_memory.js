const v8 = require('v8');
console.log(v8.getHeapStatistics());
console.log(v8.getHeapStatistics().heap_size_limit / 1024 / 1024 / 1024 ,'GB');