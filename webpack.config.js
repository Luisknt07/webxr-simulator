const application = {
  name: 'application',
  mode: 'development',
  entry: './src/index.js',
  output: {
    filename: 'bundle.js',
    path: __dirname
  },
  devtool: 'source-map',
  module: {
    rules: [
    {
      test: /\.(js|mjs)$/,
      exclude: /(node_modules)/,
      use: { loader: 'babel-loader' }
    }
  ]
  },
  watchOptions: {
    ignored: [/node_modules/],
  },
  devServer: {
    // Worker bundles have no DOM or dev-server client. Keep live reload only in
    // the application while the same compiler serves all generated files.
    injectClient: config => config.target !== 'webworker',
    injectHot: config => config.target !== 'webworker',
    before(app, server) {
      const {createApiHandler} = require('./server/api.js');
      const api = createApiHandler();
      app.use('/api', api);
      // Decode before checking: encoded paths must not expose database files via
      // the development server's general-purpose static file middleware.
      app.use((request, response, next) => {
        try {
          const raw = new URL(request.url, 'http://localhost').pathname;
          const pathname = require('path').posix.normalize(decodeURIComponent(raw).replace(/\\/g, '/'));
          const directory = pathname.split('/').filter(Boolean)[0];
          if (directory && ['data', 'server', '.git'].includes(directory.toLowerCase())) return response.status(404).end();
          if (directory && directory.toLowerCase() === 'examples' && !api.studio.access.canDownloadExamples(request)) return response.status(401).end();
          next();
        } catch (error) { response.status(400).end(); }
      });
      // Route matching is exact: only /editor enables authoring in the client.
      // Keep the trailing-slash URL canonical while preserving project links.
      app.get(/^\/editor\/$/, (request, response) => {
        const url = new URL(request.originalUrl, 'http://localhost');
        response.redirect(302, '/editor' + url.search);
      });
      app.get(/^\/editor$/, (request, response) => {
        response.sendFile(require('path').join(__dirname, 'index.html'));
      });
      setImmediate(() => { if (server.listeningApp) server.listeningApp.once('close', () => api.close()); });
      process.once('exit', () => api.close());
      console.log('Proyectos SQLite: data/projects.sqlite · archivos importados: data/uploads/');
    }
  }
};

module.exports = [application, {
  name: 'geometry-workers',
  mode: 'development',
  target: 'webworker',
  entry: {
    'mesh-optimizer-worker': './src/workers/MeshOptimizerWorker.js',
    'collision-worker': './src/workers/CollisionWorker.js'
  },
  output: {filename: '[name].js', path: __dirname, globalObject: 'self'},
  devtool: 'source-map',
  module: application.module,
  watchOptions: application.watchOptions
}];
