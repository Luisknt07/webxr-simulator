//import {Text} from '../lib/text.mjs';
import * as THREE from 'three';
import {nativeBehavior, declareNativeBehaviors} from '../../../../../packages/tools/editor/src/NativeBehaviorAdapters.js';
import { Text, Rotation, Position, ParentObject3D } from '../../../../../packages/render-three/ecs/components/index.js';

var newsTicker = {
  url: "modules/turismo/assets/tweets.json",
  hashtag: '#helloWebXR',
  hashtagText: null,
  authorText: null,
  messageText: null,
  news: [],
  current: 0
};

var screenMaterial;
var tickerObject, tickerConfigKey = '', tickerGeneration = 0, tickerElapsed = 0;

export function setup(ctx, hall) {
  const newsTickerMesh = hall.getObjectByName('newsticker');
  tickerObject = newsTickerMesh;
  declareNativeBehaviors(newsTickerMesh, [{type: 'news', url: 'tweets.json', hashtag: '#helloWebXR', interval: 3}]);

  ctx.world.createEntity();

  screenMaterial = hall.getObjectByName('screen').material;

  newsTicker.hashtagText = ctx.world.createEntity();
  newsTicker.hashtagText.addComponent(Text, {
    color: '#f6cdde', //0xdaa056,
    fontSize: 0.1,
    anchor: 'right',
    textAlign: 'right'
  }).addComponent(ParentObject3D, {value: newsTickerMesh});

  newsTicker.authorText = ctx.world.createEntity();
  newsTicker.authorText.addComponent(Text, {
    color: '#7f0c38', //0x67bccd,
    fontSize: 0.1,
    anchor: 'left',
  }).addComponent(ParentObject3D, {value: newsTickerMesh});

  newsTicker.messageText = ctx.world.createEntity();
  newsTicker.messageText.addComponent(Text, {
    color: 0x000000,
    fontSize: 0.13,
    maxWidth: 2.3,
    lineHeight: 1,
    textAlign: 'left',
    baseline: 'top',
    anchor: 'left'
  }).addComponent(ParentObject3D, {value: newsTickerMesh});

  ['hashtag', 'author', 'message'].forEach( i => {

    newsTicker[`${i}Text`].addComponent(Position, hall.getObjectByName(i).position);
    newsTicker[`${i}Text`].addComponent(Rotation, {x: 0, y: Math.PI, z: 0});
  });
  newsTicker.hashtagText.getMutableComponent(Text).text = newsTicker.hashtag;

  fetch(newsTicker.url).then(res => res.json()).then(res => {
    newsTicker.news = res;
    nextNews();
  });
}

function nextNews() {
  const n = newsTicker;
  if (!n.news.length) return;
  n.authorText.getMutableComponent(Text).text = n.news[n.current].author;
  n.messageText.getMutableComponent(Text).text = n.news[n.current].message;
  n.current = (n.current + 1) % n.news.length;
}

export function execute(ctx, delta, time) {
  const config = nativeBehavior(tickerObject, 'news');
  if (!config) return;
  newsTicker.hashtagText.getMutableComponent(Text).text = config.hashtag;
  if (tickerConfigKey !== config.url) {
    tickerConfigKey = config.url; const generation = ++tickerGeneration;
    const url = ctx.editor && ctx.editor.library ? ctx.editor.library.getURL(config.url) : "modules/turismo/assets/" + config.url;
    fetch(url).then(res => res.json()).then(rows => {
      if (generation !== tickerGeneration || !Array.isArray(rows)) return;
      newsTicker.news = rows; newsTicker.current = 0;
    }).catch(() => {});
  }
  tickerElapsed += delta;
  if (tickerElapsed >= config.interval && newsTicker.news.length) { tickerElapsed = 0; nextNews(); }
  var v = 0.98 + Math.sin(time * 40) * 0.02;
  screenMaterial.color.setRGB(v, v, v);
}
