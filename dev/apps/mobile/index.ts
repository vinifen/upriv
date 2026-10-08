import { registerRootComponent } from "expo";

import App from "./src/App";
import { holdNativeSplash } from "./src/lib/nativeSplash";

holdNativeSplash();

registerRootComponent(App);
