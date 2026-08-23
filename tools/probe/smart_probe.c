/*
 * smart_probe.c — disk-vitals 取数层可行性探针
 *
 * 用途：验证 macOS 上通过公开 IOKit API 读取 SMART 数据的两条路径。
 *   1) NVMe 路径  —— NVMeSMARTLibExternal.h，内置/PCIe 外接 NVMe，无需 root
 *   2) ATA 路径   —— ATASMARTLib.h，仅在安装了第三方 SAT SMART Driver 后才会有设备命中
 *
 * 本文件是 Sources/SmartKit 取数层的参考实现与对拍基准。
 *
 * 编译：clang -o smart_probe smart_probe.c -framework IOKit -framework CoreFoundation
 * 运行：./smart_probe            (不需要 sudo)
 */
#include <stdio.h>
#include <string.h>
#include <unistd.h>
#include <CoreFoundation/CoreFoundation.h>
#include <IOKit/IOKitLib.h>
#include <IOKit/IOCFPlugIn.h>
#include <IOKit/storage/nvme/NVMeSMARTLibExternal.h>
#include <IOKit/storage/ata/ATASMARTLib.h>

static void pstr(io_service_t s, const char *key) {
    CFStringRef k = CFStringCreateWithCString(NULL, key, kCFStringEncodingUTF8);
    CFTypeRef v = IORegistryEntryCreateCFProperty(s, k, kCFAllocatorDefault, 0);
    if (v) {
        if (CFGetTypeID(v) == CFStringGetTypeID()) {
            char buf[256];
            CFStringGetCString(v, buf, sizeof buf, kCFStringEncodingUTF8);
            printf("    %-16s %s\n", key, buf);
        }
        CFRelease(v);
    }
    CFRelease(k);
}

/* 按布尔属性匹配 IOService（"NVMe SMART Capable" / "SMART Capable"） */
static io_iterator_t match_prop(const char *key) {
    CFMutableDictionaryRef props = CFDictionaryCreateMutable(NULL, 0,
        &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
    CFStringRef k = CFStringCreateWithCString(NULL, key, kCFStringEncodingUTF8);
    CFDictionarySetValue(props, k, kCFBooleanTrue);
    CFMutableDictionaryRef m = CFDictionaryCreateMutable(NULL, 0,
        &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
    CFDictionarySetValue(m, CFSTR(kIOPropertyMatchKey), props);
    io_iterator_t it = IO_OBJECT_NULL;
    IOServiceGetMatchingServices(kIOMainPortDefault, m, &it); /* 消耗 m 的引用 */
    CFRelease(k);
    CFRelease(props);
    return it;
}

int main(void) {
    printf("uid=%d euid=%d  (0 == root)\n\n", getuid(), geteuid());

    /* ---------- NVMe ---------- */
    printf("########## NVMe SMART ##########\n");
    io_iterator_t it = match_prop(kIOPropertyNVMeSMARTCapableKey);
    io_service_t s;
    int n = 0;
    while ((s = IOIteratorNext(it))) {
        io_name_t cls;
        IOObjectGetClass(s, cls);
        printf("[%d] class=%s\n", n++, cls);
        pstr(s, "Model Number");
        pstr(s, "Serial Number");
        pstr(s, "BSD Name");

        IOCFPlugInInterface **plugin = NULL;
        SInt32 score = 0;
        kern_return_t kr = IOCreatePlugInInterfaceForService(s,
            kIONVMeSMARTUserClientTypeID, kIOCFPlugInInterfaceID, &plugin, &score);
        if (kr != KERN_SUCCESS) {
            printf("    -> IOCreatePlugInInterface FAILED 0x%08x\n", kr);
            IOObjectRelease(s);
            continue;
        }

        IONVMeSMARTInterface **smart = NULL;
        HRESULT hr = (*plugin)->QueryInterface(plugin,
            CFUUIDGetUUIDBytes(kIONVMeSMARTInterfaceID), (LPVOID *)&smart);
        if (hr != S_OK || !smart) {
            printf("    -> QueryInterface FAILED\n");
            IODestroyPlugInInterface(plugin);
            IOObjectRelease(s);
            continue;
        }

        NVMeSMARTData d;
        memset(&d, 0, sizeof d);
        IOReturn r = (*smart)->SMARTReadData(smart, &d);
        if (r == kIOReturnSuccess) {
            /* TEMPERATURE 单位为开尔文；各计数器为 128 位，低 64 位足够用 */
            printf("    -> SMARTReadData OK  temp=%.1fC  used=%u%%  spare=%u%%  "
                   "poh=%llu  cycles=%llu  unsafe=%llu  mediaErr=%llu crit=0x%02x\n",
                (double)d.TEMPERATURE - 273.15, d.PERCENTAGE_USED, d.AVAILABLE_SPARE,
                d.POWER_ON_HOURS[0], d.POWER_CYCLES[0], d.UNSAFE_SHUTDOWNS[0],
                d.MEDIA_ERRORS[0], d.CRITICAL_WARNING);
            /* 1 data unit = 512000 bytes */
            printf("       units_written=%llu (%.2f TB)  units_read=%llu (%.2f TB)\n",
                d.DATA_UNITS_WRITTEN[0], d.DATA_UNITS_WRITTEN[0] * 512000.0 / 1e12,
                d.DATA_UNITS_READ[0], d.DATA_UNITS_READ[0] * 512000.0 / 1e12);
        } else {
            printf("    -> SMARTReadData FAILED 0x%08x\n", r);
        }
        (*smart)->Release(smart);
        IODestroyPlugInInterface(plugin);
        IOObjectRelease(s);
    }
    IOObjectRelease(it);
    if (n == 0) printf("(none)\n");

    /* ---------- ATA / SATL ---------- */
    /* 未安装 SAT SMART Driver 时这里命中 0 个设备，属预期行为 */
    printf("\n########## ATA/SATL SMART ##########\n");
    it = match_prop(kIOPropertySMARTCapableKey);
    n = 0;
    while ((s = IOIteratorNext(it))) {
        io_name_t cls;
        IOObjectGetClass(s, cls);
        printf("[%d] class=%s\n", n++, cls);
        pstr(s, "BSD Name");

        IOCFPlugInInterface **plugin = NULL;
        SInt32 score = 0;
        kern_return_t kr = IOCreatePlugInInterfaceForService(s,
            kIOATASMARTUserClientTypeID, kIOCFPlugInInterfaceID, &plugin, &score);
        if (kr != KERN_SUCCESS) {
            printf("    -> IOCreatePlugInInterface FAILED 0x%08x\n", kr);
            IOObjectRelease(s);
            continue;
        }
        IOATASMARTInterface **smart = NULL;
        HRESULT hr = (*plugin)->QueryInterface(plugin,
            CFUUIDGetUUIDBytes(kIOATASMARTInterfaceID), (LPVOID *)&smart);
        if (hr == S_OK && smart) {
            ATASMARTData d;
            memset(&d, 0, sizeof d);
            IOReturn r = (*smart)->SMARTReadData(smart, &d);
            printf("    -> SMARTReadData %s (0x%08x)\n",
                   r == kIOReturnSuccess ? "OK" : "FAILED", r);
            (*smart)->Release(smart);
        } else {
            printf("    -> QueryInterface FAILED\n");
        }
        IODestroyPlugInInterface(plugin);
        IOObjectRelease(s);
    }
    IOObjectRelease(it);
    if (n == 0) printf("(none - 未安装 SAT SMART Driver 时这是预期结果)\n");
    return 0;
}
