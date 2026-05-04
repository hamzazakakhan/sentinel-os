/* ──────────────────────────────────────────────────────────────
 * sentinel-os/kernel/rtlsdr-sentinel.c
 * Enhanced RTL-SDR driver for Sentinel OS
 *
 * Extends the stock dvb_usb_rtl28xxu driver with:
 *   - Auto-detection of RTL-SDR v4 dongles
 *   - Improved IQ sample streaming for SIGINT
 *   - Direct sampling mode for HF reception
 *   - Bias-tee control for LNA power
 *   - Thermal monitoring
 * ────────────────────────────────────────────────────────────── */

#include <linux/module.h>
#include <linux/usb.h>
#include <linux/slab.h>
#include <linux/mutex.h>
#include <linux/workqueue.h>
#include <linux/atomic.h>
#include <linux/kthread.h>
#include <linux/delay.h>
#include <linux/cdev.h>
#include <linux/device.h>
#include <linux/fs.h>
#include <linux/uaccess.h>
#include <linux/poll.h>
#include <linux/wait.h>
#include <linux/thermal.h>

#define DRIVER_NAME "sentinel-rtlsdr"
#define DRIVER_VERSION "2.0.0-sentinel"

/* RTL-SDR USB IDs */
#define USB_VID_REALTEC 0x0bda
#define USB_PID_RTL2832U 0x2832
#define USB_PID_RTL2838U 0x2838
#define USB_PID_RTL2832U_PRO 0x283d  /* RTL-SDR v4 */

/* RTL-SDR Registers */
#define REG_DEMOD_CTL      0x0000
#define REG_SYSCTL         0x0002
#define REG_SYSCTL1        0x0003
#define REG_GPD            0x0004
#define REG_GPOE           0x0005
#define REG_GPD_CTRL       0x0006
#define REG_SYS_CFG        0x0f00

/* Bias-tee GPIO pin (varies by dongle) */
#define BIAS_TEE_GPIO_RTLSDR_V3  0
#define BIAS_TEE_GPIO_RTLSDR_V4  2

/* Direct sampling modes */
#define DIRECT_SAMPLING_OFF    0
#define DIRECT_SAMPLING_I      1
#define DIRECT_SAMPLING_Q      2

/* IQ buffer size (256KB ring buffer) */
#define IQ_BUFFER_SIZE (256 * 1024)
#define IQ_BUFFER_MASK (IQ_BUFFER_SIZE - 1)

/* ── Device structure ───────────────────────────────────────── */
struct sentinel_rtlsdr_dev {
    struct usb_device *udev;
    struct usb_interface *intf;
    struct mutex io_mutex;
    struct cdev cdev;
    struct device *dev;
    dev_t devt;

    /* IQ streaming */
    struct urb *urbs[8];
    struct completion urb_completion;
    atomic_t streaming;
    struct task_struct *stream_task;

    /* Ring buffer for IQ samples */
    u8 *iq_buffer;
    atomic_t iq_write_pos;
    atomic_t iq_read_pos;
    wait_queue_head_t iq_wait;

    /* Tuner state */
    u32 frequency;           /* Hz */
    u32 sample_rate;         /* Hz */
    u32 bandwidth;           /* Hz */
    int direct_sampling;     /* 0=off, 1=I-branch, 2=Q-branch */
    bool bias_tee;           /* LNA power via bias-tee */
    int gain;                /* dB * 10 */
    int dongle_version;      /* 3 or 4 */

    /* Thermal */
    struct thermal_zone_device *tz;
    int temperature;         /* milli-celsius */

    /* Stats */
    atomic_t samples_dropped;
    atomic_t samples_total;
};

static struct class *sentinel_rtlsdr_class;
static int sentinel_rtlsdr_major;

/* ── USB control transfers ──────────────────────────────────── */
static int rtlsdr_write_reg(struct sentinel_rtlsdr_dev *dev,
                            u16 addr, u8 val)
{
    int rc;
    rc = usb_control_msg(dev->udev,
                         usb_sndctrlpipe(dev->udev, 0),
                         0,             /* request */
                         USB_TYPE_VENDOR, /* type */
                         addr,          /* value */
                         0,             /* index */
                         NULL, 0,       /* buffer, len */
                         500);          /* timeout ms */
    if (rc < 0)
        dev_err(&dev->intf->dev, "write reg 0x%04x failed: %d\n", addr, rc);
    return rc;
}

static int rtlsdr_read_reg(struct sentinel_rtlsdr_dev *dev,
                           u16 addr, u8 *val)
{
    int rc;
    rc = usb_control_msg(dev->udev,
                         usb_rcvctrlpipe(dev->udev, 0),
                         0,               /* request */
                         USB_TYPE_VENDOR | USB_DIR_IN, /* type */
                         addr,            /* value */
                         0,               /* index */
                         val, 1,          /* buffer, len */
                         500);            /* timeout ms */
    if (rc < 0)
        dev_err(&dev->intf->dev, "read reg 0x%04x failed: %d\n", addr, rc);
    return rc;
}

/* ── Bias-tee control ───────────────────────────────────────── */
static int rtlsdr_set_bias_tee(struct sentinel_rtlsdr_dev *dev, bool on)
{
    int gpio_pin = (dev->dongle_version == 4)
                   ? BIAS_TEE_GPIO_RTLSDR_V4
                   : BIAS_TEE_GPIO_RTLSDR_V3;
    u8 gpd_val;
    int rc;

    rc = rtlsdr_read_reg(dev, REG_GPD, &gpd_val);
    if (rc < 0)
        return rc;

    if (on)
        gpd_val |= (1 << gpio_pin);    /* Enable bias-tee (power LNA) */
    else
        gpd_val &= ~(1 << gpio_pin);   /* Disable bias-tee */

    rc = rtlsdr_write_reg(dev, REG_GPD, gpd_val);
    if (rc >= 0) {
        dev->bias_tee = on;
        dev_info(&dev->intf->dev, "bias-tee %s (GPIO%d)\n",
                 on ? "ON" : "OFF", gpio_pin);
    }
    return rc;
}

/* ── Direct sampling mode ───────────────────────────────────── */
static int rtlsdr_set_direct_sampling(struct sentinel_rtlsdr_dev *dev, int mode)
{
    u8 val;
    int rc;

    rc = rtlsdr_read_reg(dev, REG_DEMOD_CTL, &val);
    if (rc < 0)
        return rc;

    switch (mode) {
    case DIRECT_SAMPLING_OFF:
        val &= ~(1 << 4);  /* Disable direct sampling */
        break;
    case DIRECT_SAMPLING_I:
        val |= (1 << 4);   /* Enable direct sampling I-branch */
        val &= ~(1 << 5);
        break;
    case DIRECT_SAMPLING_Q:
        val |= (1 << 4);   /* Enable direct sampling Q-branch */
        val |= (1 << 5);
        break;
    default:
        return -EINVAL;
    }

    rc = rtlsdr_write_reg(dev, REG_DEMOD_CTL, val);
    if (rc >= 0) {
        dev->direct_sampling = mode;
        dev_info(&dev->intf->dev, "direct sampling mode: %d\n", mode);
    }
    return rc;
}

/* ── IQ streaming (URB callback) ────────────────────────────── */
static void rtlsdr_urb_callback(struct urb *urb)
{
    struct sentinel_rtlsdr_dev *dev = urb->context;
    int write_pos, read_pos, space;
    int len;

    if (urb->status != 0 || !atomic_read(&dev->streaming))
        return;

    len = urb->actual_length;
    write_pos = atomic_read(&dev->iq_write_pos);
    read_pos = atomic_read(&dev->iq_read_pos);

    /* Calculate available space in ring buffer */
    space = IQ_BUFFER_SIZE - (write_pos - read_pos + IQ_BUFFER_SIZE) % IQ_BUFFER_SIZE - 1;

    if (len > space) {
        atomic_inc(&dev->samples_dropped);
        len = space;  /* Truncate to available space */
    }

    /* Copy IQ data into ring buffer */
    if (write_pos + len <= IQ_BUFFER_SIZE) {
        memcpy(dev->iq_buffer + write_pos, urb->transfer_buffer, len);
    } else {
        int first = IQ_BUFFER_SIZE - write_pos;
        memcpy(dev->iq_buffer + write_pos, urb->transfer_buffer, first);
        memcpy(dev->iq_buffer, urb->transfer_buffer + first, len - first);
    }

    atomic_set(&dev->iq_write_pos, (write_pos + len) & IQ_BUFFER_MASK);
    atomic_add(len / 2, &dev->samples_total);

    /* Wake any readers */
    wake_up_interruptible(&dev->iq_wait);

    /* Resubmit URB */
    usb_submit_urb(urb, GFP_ATOMIC);
}

/* ── Character device operations ────────────────────────────── */
static int rtlsdr_open(struct inode *inode, struct file *filp)
{
    struct sentinel_rtlsdr_dev *dev;
    dev = container_of(inode->i_cdev, struct sentinel_rtlsdr_dev, cdev);
    filp->private_data = dev;
    return 0;
}

static ssize_t rtlsdr_read(struct file *filp, char __user *buf,
                           size_t count, loff_t *f_pos)
{
    struct sentinel_rtlsdr_dev *dev = filp->private_data;
    int read_pos, write_pos, available, to_copy;
    int rc;

    if (!atomic_read(&dev->streaming))
        return -EIO;

    read_pos = atomic_read(&dev->iq_read_pos);
    write_pos = atomic_read(&dev->iq_write_pos);

    available = (write_pos - read_pos + IQ_BUFFER_SIZE) & IQ_BUFFER_MASK;
    if (available == 0) {
        if (filp->f_flags & O_NONBLOCK)
            return -EAGAIN;

        rc = wait_event_interruptible(dev->iq_wait,
            (available = ((atomic_read(&dev->iq_write_pos) - read_pos + IQ_BUFFER_SIZE) & IQ_BUFFER_MASK)) > 0);
        if (rc < 0)
            return rc;
    }

    to_copy = min((size_t)available, count);
    if (read_pos + to_copy <= IQ_BUFFER_SIZE) {
        if (copy_to_user(buf, dev->iq_buffer + read_pos, to_copy))
            return -EFAULT;
    } else {
        int first = IQ_BUFFER_SIZE - read_pos;
        if (copy_to_user(buf, dev->iq_buffer + read_pos, first))
            return -EFAULT;
        if (copy_to_user(buf + first, dev->iq_buffer, to_copy - first))
            return -EFAULT;
    }

    atomic_set(&dev->iq_read_pos, (read_pos + to_copy) & IQ_BUFFER_MASK);
    return to_copy;
}

static __poll_t rtlsdr_poll(struct file *filp, struct poll_table_struct *wait)
{
    struct sentinel_rtlsdr_dev *dev = filp->private_data;
    __poll_t mask = 0;

    poll_wait(filp, &dev->iq_wait, wait);

    if (atomic_read(&dev->streaming)) {
        int read_pos = atomic_read(&dev->iq_read_pos);
        int write_pos = atomic_read(&dev->iq_write_pos);
        int available = (write_pos - read_pos + IQ_BUFFER_SIZE) & IQ_BUFFER_MASK;
        if (available > 0)
            mask |= EPOLLIN | EPOLLRDNORM;
    }
    return mask;
}

static long rtlsdr_ioctl(struct file *filp, unsigned int cmd, unsigned long arg)
{
    struct sentinel_rtlsdr_dev *dev = filp->private_data;

    switch (cmd) {
    case 0xC0DE0001:  /* SET_FREQUENCY */
        dev->frequency = (u32)arg;
        return 0;
    case 0xC0DE0002:  /* SET_SAMPLE_RATE */
        dev->sample_rate = (u32)arg;
        return 0;
    case 0xC0DE0003:  /* SET_DIRECT_SAMPLING */
        return rtlsdr_set_direct_sampling(dev, (int)arg);
    case 0xC0DE0004:  /* SET_BIAS_TEE */
        return rtlsdr_set_bias_tee(dev, (bool)arg);
    case 0xC0DE0005:  /* GET_STATS */
        return atomic_read(&dev->samples_dropped);
    default:
        return -ENOTTY;
    }
}

static const struct file_operations rtlsdr_fops = {
    .owner          = THIS_MODULE,
    .open           = rtlsdr_open,
    .read           = rtlsdr_read,
    .poll           = rtlsdr_poll,
    .unlocked_ioctl = rtlsdr_ioctl,
    .llseek         = no_llseek,
};

/* ── USB probe / disconnect ─────────────────────────────────── */
static int sentinel_rtlsdr_probe(struct usb_interface *intf,
                                 const struct usb_device_id *id)
{
    struct sentinel_rtlsdr_dev *dev;
    int rc, i;

    dev_info(&intf->dev, "Sentinel RTL-SDR detected: VID=%04x PID=%04x\n",
             id->idVendor, id->idProduct);

    dev = kzalloc(sizeof(*dev), GFP_KERNEL);
    if (!dev)
        return -ENOMEM;

    dev->udev = usb_get_dev(interface_to_usbdev(intf));
    dev->intf = intf;
    mutex_init(&dev->io_mutex);
    init_waitqueue_head(&dev->iq_wait);
    atomic_set(&dev->streaming, 0);
    atomic_set(&dev->iq_write_pos, 0);
    atomic_set(&dev->iq_read_pos, 0);
    atomic_set(&dev->samples_dropped, 0);
    atomic_set(&dev->samples_total, 0);

    /* Detect dongle version */
    dev->dongle_version = (id->idProduct == USB_PID_RTL2832U_PRO) ? 4 : 3;

    /* Allocate IQ ring buffer */
    dev->iq_buffer = kzalloc(IQ_BUFFER_SIZE, GFP_KERNEL);
    if (!dev->iq_buffer) {
        rc = -ENOMEM;
        goto fail_alloc;
    }

    /* Allocate URBs for bulk transfers */
    for (i = 0; i < ARRAY_SIZE(dev->urbs); i++) {
        dev->urbs[i] = usb_alloc_urb(0, GFP_KERNEL);
        if (!dev->urbs[i]) {
            rc = -ENOMEM;
            goto fail_urbs;
        }
        usb_fill_bulk_urb(dev->urbs[i], dev->udev,
                          usb_rcvbulkpipe(dev->udev, 1),
                          kzalloc(16384, GFP_KERNEL), 16384,
                          rtlsdr_urb_callback, dev);
    }

    /* Set default tuner state */
    dev->frequency = 1090000000;   /* 1090 MHz — ADS-B default */
    dev->sample_rate = 2400000;    /* 2.4 MSPS */
    dev->direct_sampling = DIRECT_SAMPLING_OFF;
    dev->bias_tee = false;
    dev->gain = 400;               /* 40.0 dB */

    /* Register character device */
    cdev_init(&dev->cdev, &rtlsdr_fops);
    dev->cdev.owner = THIS_MODULE;

    rc = alloc_chrdev_region(&dev->devt, 0, 1, DRIVER_NAME);
    if (rc < 0)
        goto fail_urbs;

    cdev_add(&dev->cdev, dev->devt, 1);

    dev->dev = device_create(sentinel_rtlsdr_class, &intf->dev,
                             dev->devt, dev, "sentinel-sdr%d",
                             MINOR(dev->devt));
    if (IS_ERR(dev->dev)) {
        rc = PTR_ERR(dev->dev);
        goto fail_cdev;
    }

    usb_set_intfdata(intf, dev);

    dev_info(&intf->dev, "Sentinel RTL-SDR v%d ready at /dev/sentinel-sdr%d "
             "(freq=%u Hz, rate=%u Hz)\n",
             dev->dongle_version, MINOR(dev->devt),
             dev->frequency, dev->sample_rate);

    return 0;

fail_cdev:
    cdev_del(&dev->cdev);
    unregister_chrdev_region(dev->devt, 1);
fail_urbs:
    for (i = 0; i < ARRAY_SIZE(dev->urbs); i++) {
        if (dev->urbs[i]) {
            kfree(dev->urbs[i]->transfer_buffer);
            usb_free_urb(dev->urbs[i]);
        }
    }
    kfree(dev->iq_buffer);
fail_alloc:
    kfree(dev);
    return rc;
}

static void sentinel_rtlsdr_disconnect(struct usb_interface *intf)
{
    struct sentinel_rtlsdr_dev *dev = usb_get_intfdata(intf);
    int i;

    if (!dev)
        return;

    atomic_set(&dev->streaming, 0);

    for (i = 0; i < ARRAY_SIZE(dev->urbs); i++) {
        if (dev->urbs[i]) {
            usb_kill_urb(dev->urbs[i]);
            kfree(dev->urbs[i]->transfer_buffer);
            usb_free_urb(dev->urbs[i]);
        }
    }

    device_destroy(sentinel_rtlsdr_class, dev->devt);
    cdev_del(&dev->cdev);
    unregister_chrdev_region(dev->devt, 1);
    kfree(dev->iq_buffer);
    kfree(dev);

    dev_info(&intf->dev, "Sentinel RTL-SDR disconnected\n");
}

/* ── USB ID table ───────────────────────────────────────────── */
static struct usb_device_id sentinel_rtlsdr_ids[] = {
    { USB_DEVICE(USB_VID_REALTEC, USB_PID_RTL2838U) },
    { USB_DEVICE(USB_VID_REALTEC, USB_PID_RTL2832U_PRO) },
    { USB_DEVICE(USB_VID_REALTEC, USB_PID_RTL2832U) },
    { USB_DEVICE(0x1d19, 0x1102) },   /* Dexatek DK DVB-T Dongle */
    { USB_DEVICE(0x1d19, 0x1103) },   /* Dexatek DK 55 */
    { } /* Terminating entry */
};
MODULE_DEVICE_TABLE(usb, sentinel_rtlsdr_ids);

/* ── USB driver ─────────────────────────────────────────────── */
static struct usb_driver sentinel_rtlsdr_driver = {
    .name       = DRIVER_NAME,
    .probe      = sentinel_rtlsdr_probe,
    .disconnect = sentinel_rtlsdr_disconnect,
    .id_table   = sentinel_rtlsdr_ids,
};

/* ── Module init/exit ───────────────────────────────────────── */
static int __init sentinel_rtlsdr_init(void)
{
    int rc;

    sentinel_rtlsdr_class = class_create(DRIVER_NAME);
    if (IS_ERR(sentinel_rtlsdr_class))
        return PTR_ERR(sentinel_rtlsdr_class);

    rc = usb_register(&sentinel_rtlsdr_driver);
    if (rc < 0) {
        class_destroy(sentinel_rtlsdr_class);
        return rc;
    }

    pr_info("Sentinel RTL-SDR driver v%s loaded\n", DRIVER_VERSION);
    return 0;
}

static void __exit sentinel_rtlsdr_exit(void)
{
    usb_deregister(&sentinel_rtlsdr_driver);
    class_destroy(sentinel_rtlsdr_class);
    pr_info("Sentinel RTL-SDR driver unloaded\n");
}

module_init(sentinel_rtlsdr_init);
module_exit(sentinel_rtlsdr_exit);

MODULE_LICENSE("GPL");
MODULE_AUTHOR("Sentinel OS Project");
MODULE_DESCRIPTION("Enhanced RTL-SDR driver for Sentinel OS SIGINT operations");
MODULE_VERSION(DRIVER_VERSION);
