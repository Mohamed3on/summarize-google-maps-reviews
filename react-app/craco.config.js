const { ChangeJsFilename, ChangeCssFilename } = require('@navikt/craco-plugins');

module.exports = {
  webpack: {
    configure: {
      devtool: 'inline-source-map',
    },
  },
  plugins: [
    {
      plugin: ChangeCssFilename,
      options: {
        filename: 'main.css',
        runtimeChunk: false,
      },
    },
    {
      plugin: ChangeJsFilename,
      options: {
        filename: 'main.js',
        runtimeChunk: false,
      },
    },
  ],
};
