module.exports = function (api) {
  api.cache(true);
  return {
    presets: ["babel-preset-expo"],
    plugins: [
      [
        "module-resolver",
        {
          root: ["."],
          alias: {
            "@": "./src",
            "@upriv/shared/react": "../shared/src/react",
            "@upriv/shared/testing": "../shared/src/testing",
            "@upriv/shared": "../shared/src",
            "upriv-core": "./modules/upriv-core/src",
          },
          extensions: [".ios.js", ".android.js", ".js", ".ts", ".tsx", ".json"],
        },
      ],
    ],
  };
};
