import { defineTypedCommand } from "../services/command/registry";
import {
  listDebugStreams,
  runDebugCommand,
  startDebugStream,
  stopDebugStream,
} from "../services/conductor/debug";
import { listDevices, stopDevice } from "../services/conductor/devices";
import {
  conductorLogStore,
  runConductorCommand,
} from "../services/conductor/logger";
import { openDeepLink } from "../services/conductor/openLink";
import {
  addEasDeviceHost,
  checkEasAccount,
  listEasDeviceHosts,
  removeEasDeviceHost,
  updateEasDeviceHost,
} from "../services/deviceHosts/eas/registry";
import {
  addDeviceHost,
  listDeviceHosts,
  removeDeviceHost,
  testDeviceHost,
} from "../services/deviceHosts/registry";
import { captureUi } from "../services/inspection/capture";
import { setNodeProperty } from "../services/inspection/edit";
import {
  launchInjected,
  listInstalledApps,
  probeInjection,
} from "../services/inspection/launcher";
import { getNodeProps } from "../services/inspection/props";
import {
  androidButton,
  androidKeyboard,
  androidTouch,
  bootAndroidEmulator,
  checkAndroidTools,
  disconnectAndroidDevice,
  listAndroidDevices,
  listAvds,
  startAndroidCapture,
  stopAndroidCapture,
} from "../services/simulator/android";
import { getDeviceInputEndpoint } from "../services/simulator/deviceInput";
import {
  activeSimulator,
  bootSimulator,
  checkIosTools,
  disconnectSimulator,
  listAllSimulators,
  simulatorButton,
  simulatorDeviceState,
  simulatorKeyboard,
  simulatorSetFold,
  simulatorSetOrientation,
  simulatorTouch,
  startSimulatorCapture,
  stopSimulatorCapture,
} from "../services/simulator/ios";
import {
  deleteSimulator,
  eraseSimulator,
} from "../services/simulator/simulatorRepair";

function registerSimulatorCommands(): void {
  defineTypedCommand("check_ios_tools", () => checkIosTools());
  defineTypedCommand("list_simulators", () => listAllSimulators());
  defineTypedCommand("boot_simulator", (p) => bootSimulator(p.udid));
  defineTypedCommand("erase_simulator", (p) => eraseSimulator(p.udid));
  defineTypedCommand("delete_simulator", (p) => deleteSimulator(p.udid));
  defineTypedCommand("disconnect_simulator", (p) =>
    disconnectSimulator(p.udid),
  );
  defineTypedCommand("active_simulator", () => activeSimulator());
  defineTypedCommand("start_simulator_capture", (p) =>
    startSimulatorCapture(p.udid),
  );
  defineTypedCommand("stop_simulator_capture", (p) =>
    stopSimulatorCapture(p.udid),
  );
  defineTypedCommand("simulator_touch", (p) =>
    simulatorTouch(p.udid, p.x, p.y, p.eventType),
  );
  defineTypedCommand("simulator_device_state", (p) =>
    simulatorDeviceState(p.udid),
  );
  defineTypedCommand("simulator_set_fold", (p) =>
    simulatorSetFold(p.udid, p.pose),
  );
  defineTypedCommand("simulator_set_orientation", (p) =>
    simulatorSetOrientation(p.udid, p.orientation),
  );
  defineTypedCommand("simulator_button", (p) =>
    simulatorButton(p.udid, p.button),
  );
  defineTypedCommand("simulator_keyboard", (p) =>
    simulatorKeyboard(p.udid, p.keyCode, p.modifierFlags, p.isDown),
  );
  defineTypedCommand("device_input_endpoint", (p) =>
    getDeviceInputEndpoint(p.deviceKey),
  );
  defineTypedCommand("device_open_link", (p) =>
    openDeepLink(p.deviceKey, p.url),
  );
}

function registerAndroidCommands(): void {
  defineTypedCommand("check_android_tools", () => checkAndroidTools());
  defineTypedCommand("list_android_devices", () => listAndroidDevices());
  defineTypedCommand("list_avds", () => listAvds());
  defineTypedCommand("boot_android_emulator", (p) =>
    bootAndroidEmulator(p.avdName),
  );
  defineTypedCommand("start_android_capture", (p) =>
    startAndroidCapture(p.serial),
  );
  defineTypedCommand("stop_android_capture", (p) =>
    stopAndroidCapture(p.serial),
  );
  defineTypedCommand("disconnect_android_device", (p) =>
    disconnectAndroidDevice(p.serial),
  );
  defineTypedCommand("android_touch", (p) =>
    androidTouch(p.serial, p.x, p.y, p.eventType),
  );
  defineTypedCommand("android_keyboard", (p) =>
    androidKeyboard(p.serial, p.keyCode, p.metaState, p.isDown),
  );
  defineTypedCommand("android_button", (p) =>
    androidButton(p.serial, p.button),
  );
}

function registerConductorCommands(): void {
  defineTypedCommand("list_devices", () => listDevices());
  defineTypedCommand("stop_device", (p) => stopDevice(p.platform, p.deviceKey));
  defineTypedCommand("list_conductor_logs", (p) =>
    conductorLogStore.list(p.deviceKey),
  );
  defineTypedCommand("run_conductor_command", (p) =>
    runConductorCommand(p.deviceKey, p.args),
  );
  defineTypedCommand("inspection_capture", (p) =>
    captureUi({ deviceKey: p.deviceKey }),
  );
  defineTypedCommand("inspection_probe", (p) => probeInjection(p.deviceKey));
  defineTypedCommand("inspection_list_apps", (p) =>
    listInstalledApps(p.deviceKey),
  );
  defineTypedCommand("inspection_launch_injected", (p) =>
    launchInjected(p.deviceKey, p.bundleId),
  );
  defineTypedCommand("inspection_set_property", (p) => setNodeProperty(p));
  defineTypedCommand("inspection_node_props", (p) =>
    getNodeProps(p.deviceKey, p.nodeId),
  );
  defineTypedCommand("debug_start_stream", (p) => {
    startDebugStream(p);

    return null;
  });
  defineTypedCommand("debug_stop_stream", (p) => {
    stopDebugStream(p.streamId);

    return null;
  });
  defineTypedCommand("debug_list_streams", () => listDebugStreams());
  defineTypedCommand("debug_run_command", (p) =>
    runDebugCommand(p.deviceKey, p.args),
  );
}

function registerDeviceHostCommands(): void {
  defineTypedCommand("list_device_hosts", () => listDeviceHosts());
  defineTypedCommand("add_device_host", (p) => addDeviceHost(p));
  defineTypedCommand("remove_device_host", (p) => removeDeviceHost(p.id));
  defineTypedCommand("test_device_host", (p) => testDeviceHost(p));
  defineTypedCommand("list_eas_device_hosts", () => listEasDeviceHosts());
  defineTypedCommand("add_eas_device_host", (p) => addEasDeviceHost(p));
  defineTypedCommand("update_eas_device_host", (p) => updateEasDeviceHost(p));
  defineTypedCommand("remove_eas_device_host", (p) =>
    removeEasDeviceHost(p.id),
  );
  defineTypedCommand("check_eas_account", (p) => checkEasAccount(p));
}

export function registerDeviceCommands(): void {
  registerSimulatorCommands();
  registerAndroidCommands();
  registerConductorCommands();
  registerDeviceHostCommands();
}
