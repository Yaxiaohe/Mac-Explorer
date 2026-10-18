#import <AppKit/AppKit.h>
#import <CoreServices/CoreServices.h>
#import <ServiceManagement/ServiceManagement.h>
#include <node_api.h>
#include <string>

// Default-application and login-item plumbing. Everything runs inside the app process:
// SMAppService registers the app itself, so a helper binary could only register the helper.

static NSString *StringFrom(napi_env env, napi_value value) {
  size_t length = 0;
  if (napi_get_value_string_utf8(env, value, nullptr, 0, &length) != napi_ok) return nil;
  std::string buffer(length + 1, '\0');
  if (napi_get_value_string_utf8(env, value, buffer.data(), buffer.size(), &length) != napi_ok) return nil;
  return [NSString stringWithUTF8String:buffer.c_str()];
}

static napi_value BoolValue(napi_env env, BOOL value) {
  napi_value result;
  napi_get_boolean(env, value, &result);
  return result;
}

static napi_value Text(napi_env env, NSString *value) {
  napi_value result;
  if (!value) { napi_get_null(env, &result); return result; }
  napi_create_string_utf8(env, value.UTF8String, NAPI_AUTO_LENGTH, &result);
  return result;
}

static void Fail(napi_env env, NSString *message) {
  napi_throw_error(env, nullptr, message ? message.UTF8String : "Unknown error");
}

static napi_value AppURL(napi_env env, napi_callback_info info) {
  return Text(env, NSBundle.mainBundle.bundleURL.path);
}

static napi_value BundleID(napi_env env, napi_callback_info info) {
  return Text(env, NSBundle.mainBundle.bundleIdentifier);
}

static napi_value LoginEnabled(napi_env env, napi_callback_info info) {
  if (@available(macOS 13.0, *)) return BoolValue(env, SMAppService.mainAppService.status == SMAppServiceStatusEnabled);
  return BoolValue(env, NO);
}

static napi_value SetLogin(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argument;
  napi_get_cb_info(env, info, &argc, &argument, nullptr, nullptr);
  BOOL enable = NO;
  if (argc != 1 || napi_get_value_bool(env, argument, &enable) != napi_ok) {
    napi_throw_type_error(env, nullptr, "Expected a boolean");
    return nullptr;
  }
  if (@available(macOS 13.0, *)) {
    NSError *error = nil;
    BOOL ok = enable ? [SMAppService.mainAppService registerAndReturnError:&error] : [SMAppService.mainAppService unregisterAndReturnError:&error];
    if (!ok) { Fail(env, error.localizedDescription ?: @"登录项设置失败。"); return nullptr; }
    return BoolValue(env, YES);
  }
  Fail(env, @"This macOS version cannot register a login item.");
  return nullptr;
}

static napi_value DefaultHandler(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argument;
  napi_get_cb_info(env, info, &argc, &argument, nullptr, nullptr);
  NSString *type = StringFrom(env, argument);
  if (type.length == 0) { napi_throw_type_error(env, nullptr, "Expected a content type"); return nullptr; }
  CFStringRef handler = LSCopyDefaultRoleHandlerForContentType((__bridge CFStringRef)type, kLSRolesAll);
  if (!handler) { napi_value null; napi_get_null(env, &null); return null; }
  NSString *value = [NSString stringWithString:(__bridge NSString *)handler];
  CFRelease(handler);
  return Text(env, value);
}

// LaunchServices only accepts a file, not a folder: the election is stored for the file's type.
// Passing an empty application path means "make this app the default".
static napi_value SetDefaultForFile(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value arguments[2];
  napi_get_cb_info(env, info, &argc, arguments, nullptr, nullptr);
  NSString *application = argc > 0 ? StringFrom(env, arguments[0]) : nil;
  NSString *file = argc > 1 ? StringFrom(env, arguments[1]) : nil;
  if (file.length == 0) { napi_throw_type_error(env, nullptr, "Expected a file path"); return nullptr; }
  NSURL *applicationURL = application.length ? [NSURL fileURLWithPath:application] : NSBundle.mainBundle.bundleURL;
  NSURL *fileURL = [NSURL fileURLWithPath:file];
  __block NSError *failure = nil;
  dispatch_semaphore_t done = dispatch_semaphore_create(0);
  [NSWorkspace.sharedWorkspace setDefaultApplicationAtURL:applicationURL toOpenFileAtURL:fileURL completionHandler:^(NSError *error) {
    failure = error;
    dispatch_semaphore_signal(done);
  }];
  dispatch_semaphore_wait(done, dispatch_time(DISPATCH_TIME_NOW, 10 * NSEC_PER_SEC));
  if (failure) { Fail(env, failure.localizedDescription ?: @"默认应用设置失败。"); return nullptr; }
  return BoolValue(env, YES);
}

// A native drag session owns the mouse: the renderer never sees the mouseup that ends it. The
// main process polls the left button instead, which is how the drop tracker learns the gesture
// is over and where the cursor stopped.
static napi_value MouseDown(napi_env env, napi_callback_info info) {
  return BoolValue(env, ([NSEvent pressedMouseButtons] & 1) != 0);
}

static napi_value Init(napi_env env, napi_value exports) {
  napi_value appURL, bundleID, loginEnabled, setLogin, defaultHandler, setDefaultForFile, mouseDown;
  napi_create_function(env, "appURL", NAPI_AUTO_LENGTH, AppURL, nullptr, &appURL);
  napi_create_function(env, "bundleID", NAPI_AUTO_LENGTH, BundleID, nullptr, &bundleID);
  napi_create_function(env, "loginEnabled", NAPI_AUTO_LENGTH, LoginEnabled, nullptr, &loginEnabled);
  napi_create_function(env, "setLogin", NAPI_AUTO_LENGTH, SetLogin, nullptr, &setLogin);
  napi_create_function(env, "defaultHandler", NAPI_AUTO_LENGTH, DefaultHandler, nullptr, &defaultHandler);
  napi_create_function(env, "setDefaultForFile", NAPI_AUTO_LENGTH, SetDefaultForFile, nullptr, &setDefaultForFile);
  napi_create_function(env, "mouseDown", NAPI_AUTO_LENGTH, MouseDown, nullptr, &mouseDown);
  napi_set_named_property(env, exports, "appURL", appURL);
  napi_set_named_property(env, exports, "bundleID", bundleID);
  napi_set_named_property(env, exports, "loginEnabled", loginEnabled);
  napi_set_named_property(env, exports, "setLogin", setLogin);
  napi_set_named_property(env, exports, "defaultHandler", defaultHandler);
  napi_set_named_property(env, exports, "setDefaultForFile", setDefaultForFile);
  napi_set_named_property(env, exports, "mouseDown", mouseDown);
  return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
