// Patch os module constants (injected by webpack DefinePlugin)
import os from "os";
declare const __os_constants: any;

if (typeof __os_constants !== "undefined") {
    os.constants = __os_constants;
}
os.platform = () => "linux";
os.homedir = () => "/";
os.tmpdir = () => "/tmp";
os.EOL = "\n";
