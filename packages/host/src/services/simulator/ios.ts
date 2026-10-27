/**
 * iOS Simulator control — the public face of the simulator layer.
 *
 * Every device comes from a {@link DeviceSource} (`deviceSource.ts`): this Mac
 * and SSH device hosts through `machineSource.ts` (simctl + argus-sim-bridge +
 * the in-guest argus-sim-input helper). Listing lives in `simulatorList.ts`,
 * capture and device state in `iosCapture.ts`, input in `iosInput.ts`.
 */

export type { SimulatorDevice } from "./deviceSource";
export { fixupRuntimeVersion, runtimeIdToHuman } from "./simctl";
export {
  activeSimulator,
  bootSimulator,
  checkIosTools,
  listAllSimulators,
  listSimulators,
} from "./simulatorList";
export {
  captureSessionFor,
  disconnectSimulator,
  forceStopSimulatorCapture,
  isSimulatorCapturing,
  simulatorDeviceState,
  simulatorSetFold,
  simulatorSetOrientation,
  startSimulatorCapture,
  stopSimulatorCapture,
} from "./iosCapture";
export { simulatorButton, simulatorKeyboard, simulatorTouch } from "./iosInput";
