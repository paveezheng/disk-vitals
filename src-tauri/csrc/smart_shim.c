#include "smart_shim.h"

#include <string.h>
#include <CoreFoundation/CoreFoundation.h>
#include <IOKit/IOKitLib.h>
#include <IOKit/IOCFPlugIn.h>
#include <IOKit/storage/nvme/NVMeSMARTLibExternal.h>

/* NVMe identify 里的字符串是空格填充且不带结尾 NUL，需要拷贝后裁掉尾部空格 */
static void copy_padded(char *dst, size_t dst_len, const uint8_t *src, size_t src_len) {
    size_t n = src_len < dst_len - 1 ? src_len : dst_len - 1;
    memcpy(dst, src, n);
    dst[n] = '\0';
    while (n > 0 && (dst[n - 1] == ' ' || dst[n - 1] == '\t')) dst[--n] = '\0';
}

static void copy_cfstring(char *dst, size_t dst_len, CFStringRef s) {
    if (!s || CFGetTypeID(s) != CFStringGetTypeID()) return;
    CFStringGetCString(s, dst, (CFIndex)dst_len, kCFStringEncodingUTF8);
}

/* 在 IOService plane 上向子节点递归查找属性 */
static CFTypeRef search_child(io_service_t s, CFStringRef key) {
    return IORegistryEntrySearchCFProperty(s, kIOServicePlane, key,
        kCFAllocatorDefault, kIORegistryIterateRecursively);
}

/* 向父节点递归查找属性 */
static CFTypeRef search_parent(io_service_t s, CFStringRef key) {
    return IORegistryEntrySearchCFProperty(s, kIOServicePlane, key,
        kCFAllocatorDefault, kIORegistryIterateRecursively | kIORegistryIterateParents);
}

/* 构造 { kIOPropertyMatchKey : { key : true } } 匹配字典 */
static io_iterator_t match_bool_prop(CFStringRef key) {
    CFMutableDictionaryRef props = CFDictionaryCreateMutable(NULL, 0,
        &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
    CFDictionarySetValue(props, key, kCFBooleanTrue);
    CFMutableDictionaryRef m = CFDictionaryCreateMutable(NULL, 0,
        &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
    CFDictionarySetValue(m, CFSTR(kIOPropertyMatchKey), props);
    io_iterator_t it = IO_OBJECT_NULL;
    /* IOServiceGetMatchingServices 消耗 m 的引用 */
    IOServiceGetMatchingServices(kIOMainPortDefault, m, &it);
    CFRelease(props);
    return it;
}

/* 填充型号/序列号/固件版本。这些属性不在 block device service 上，必须走 Identify */
static void fill_identity(IONVMeSMARTInterface **smart, io_service_t s, DvNvmeDevice *d) {
    uint8_t buf[4096];
    memset(buf, 0, sizeof buf);
    if ((*smart)->GetIdentifyData(smart, buf, 0) == kIOReturnSuccess) {
        const NVMeIdentifyControllerStruct *id = (const NVMeIdentifyControllerStruct *)buf;
        copy_padded(d->model,    sizeof d->model,    id->MODEL_NUMBER,  sizeof id->MODEL_NUMBER);
        copy_padded(d->serial,   sizeof d->serial,   id->SERIAL_NUMBER, sizeof id->SERIAL_NUMBER);
        copy_padded(d->firmware, sizeof d->firmware, id->FW_REVISION,   sizeof id->FW_REVISION);
    }
    /* Identify 失败时退回 IORegistry 上层控制器节点 */
    if (d->model[0] == '\0') {
        CFTypeRef v = search_parent(s, CFSTR("Model Number"));
        if (v) { copy_cfstring(d->model, sizeof d->model, (CFStringRef)v); CFRelease(v); }
    }
    if (d->serial[0] == '\0') {
        CFTypeRef v = search_parent(s, CFSTR("Serial Number"));
        if (v) { copy_cfstring(d->serial, sizeof d->serial, (CFStringRef)v); CFRelease(v); }
    }
    if (d->firmware[0] == '\0') {
        CFTypeRef v = search_parent(s, CFSTR("Firmware Revision"));
        if (v) { copy_cfstring(d->firmware, sizeof d->firmware, (CFStringRef)v); CFRelease(v); }
    }
}

/* BSD 名、容量、接口类型、内置/外接 */
static void fill_topology(io_service_t s, DvNvmeDevice *d) {
    CFTypeRef v;

    if ((v = search_child(s, CFSTR("BSD Name")))) {
        copy_cfstring(d->bsd_name, sizeof d->bsd_name, (CFStringRef)v);
        CFRelease(v);
    }
    if ((v = search_child(s, CFSTR("Size")))) {
        if (CFGetTypeID(v) == CFNumberGetTypeID())
            CFNumberGetValue((CFNumberRef)v, kCFNumberSInt64Type, &d->capacity_bytes);
        CFRelease(v);
    }

    d->is_internal = -1;
    /* "Physical Interconnect" 嵌在 "Protocol Characteristics" 字典里，先取字典 */
    v = search_parent(s, CFSTR("Protocol Characteristics"));
    if (!v) v = search_child(s, CFSTR("Protocol Characteristics"));
    if (v) {
        if (CFGetTypeID(v) == CFDictionaryGetTypeID()) {
            CFDictionaryRef pc = (CFDictionaryRef)v;
            CFStringRef pi = CFDictionaryGetValue(pc, CFSTR("Physical Interconnect"));
            copy_cfstring(d->protocol, sizeof d->protocol, pi);
            CFStringRef loc = CFDictionaryGetValue(pc, CFSTR("Physical Interconnect Location"));
            if (loc && CFGetTypeID(loc) == CFStringGetTypeID())
                d->is_internal = CFStringCompare(loc, CFSTR("Internal"), 0) == kCFCompareEqualTo ? 1 : 0;
        }
        CFRelease(v);
    }
    /* 内置 Apple SSD 走 Apple Fabric，不一定有 Protocol Characteristics */
    if (d->protocol[0] == '\0') {
        io_name_t cls;
        if (IOObjectGetClass(s, cls) == KERN_SUCCESS &&
            strcmp(cls, "IOEmbeddedNVMeBlockDevice") == 0) {
            snprintf(d->protocol, sizeof d->protocol, "Apple Fabric");
            d->is_internal = 1;
        }
    }
}

int32_t dv_nvme_device_size(void) {
    return (int32_t)sizeof(DvNvmeDevice);
}

int32_t dv_nvme_enumerate(DvNvmeDevice *out, int32_t max_count) {
    if (!out || max_count <= 0) return -1;

    io_iterator_t it = match_bool_prop(CFSTR(kIOPropertyNVMeSMARTCapableKey));
    if (it == IO_OBJECT_NULL) return 0;

    int32_t n = 0;
    io_service_t s;
    while (n < max_count && (s = IOIteratorNext(it))) {
        IOCFPlugInInterface **plugin = NULL;
        SInt32 score = 0;
        if (IOCreatePlugInInterfaceForService(s, kIONVMeSMARTUserClientTypeID,
                kIOCFPlugInInterfaceID, &plugin, &score) != KERN_SUCCESS) {
            IOObjectRelease(s);
            continue;
        }

        IONVMeSMARTInterface **smart = NULL;
        HRESULT hr = (*plugin)->QueryInterface(plugin,
            CFUUIDGetUUIDBytes(kIONVMeSMARTInterfaceID), (LPVOID *)&smart);
        if (hr != S_OK || !smart) {
            IODestroyPlugInInterface(plugin);
            IOObjectRelease(s);
            continue;
        }

        NVMeSMARTData sd;
        memset(&sd, 0, sizeof sd);
        if ((*smart)->SMARTReadData(smart, &sd) == kIOReturnSuccess) {
            DvNvmeDevice *d = &out[n];
            memset(d, 0, sizeof *d);

            d->critical_warning          = sd.CRITICAL_WARNING;
            d->temperature_k             = sd.TEMPERATURE;
            d->available_spare           = sd.AVAILABLE_SPARE;
            d->available_spare_threshold = sd.AVAILABLE_SPARE_THRESHOLD;
            d->percentage_used           = sd.PERCENTAGE_USED;
            /* 各计数器是 128 位小端，低 64 位足够表达现实数值 */
            d->data_units_read      = sd.DATA_UNITS_READ[0];
            d->data_units_written   = sd.DATA_UNITS_WRITTEN[0];
            d->host_read_commands   = sd.HOST_READ_COMMANDS[0];
            d->host_write_commands  = sd.HOST_WRITE_COMMANDS[0];
            d->controller_busy_time = sd.CONTROLLER_BUSY_TIME[0];
            d->power_cycles         = sd.POWER_CYCLES[0];
            d->power_on_hours       = sd.POWER_ON_HOURS[0];
            d->unsafe_shutdowns     = sd.UNSAFE_SHUTDOWNS[0];
            d->media_errors         = sd.MEDIA_ERRORS[0];
            d->error_log_entries    = sd.NUM_ERROR_INFO_LOG_ENTRIES[0];

            fill_identity(smart, s, d);
            fill_topology(s, d);
            n++;
        }

        (*smart)->Release(smart);
        IODestroyPlugInInterface(plugin);
        IOObjectRelease(s);
    }
    IOObjectRelease(it);
    return n;
}

#ifdef DV_SHIM_MAIN
#include <stdio.h>
int main(void) {
    DvNvmeDevice devs[DV_MAX_DEVICES];
    int32_t n = dv_nvme_enumerate(devs, DV_MAX_DEVICES);
    printf("dv_nvme_enumerate -> %d device(s)\n\n", n);
    for (int32_t i = 0; i < n; i++) {
        DvNvmeDevice *d = &devs[i];
        printf("[%d] %s\n", i, d->model);
        printf("    serial=%s  fw=%s  bsd=%s\n", d->serial, d->firmware, d->bsd_name);
        printf("    protocol=%s  internal=%d  capacity=%.2f GB\n",
               d->protocol, d->is_internal, d->capacity_bytes / 1e9);
        printf("    temp=%.1fC  used=%u%%  spare=%u%%/%u%%  crit=0x%02x\n",
               d->temperature_k - 273.15, d->percentage_used,
               d->available_spare, d->available_spare_threshold, d->critical_warning);
        printf("    poh=%llu  cycles=%llu  unsafe=%llu  mediaErr=%llu  errLog=%llu\n",
               d->power_on_hours, d->power_cycles, d->unsafe_shutdowns,
               d->media_errors, d->error_log_entries);
        printf("    written=%.2f TB  read=%.2f TB\n\n",
               d->data_units_written * 512000.0 / 1e12,
               d->data_units_read * 512000.0 / 1e12);
    }
    return 0;
}
#endif
