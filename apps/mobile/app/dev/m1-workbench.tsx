import { Redirect } from "expo-router";
import type { ComponentType } from "react";

const Workbench = __DEV__
  ? (require("../../src/screens/M1WorkbenchScreen") as { M1WorkbenchScreen: ComponentType }).M1WorkbenchScreen
  : null;

export default function DevelopmentWorkbench() {
  return Workbench ? <Workbench /> : <Redirect href="/me" />;
}
