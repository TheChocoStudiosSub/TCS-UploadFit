using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace TCS.UploadFit.Host;

public sealed class MainForm : Form
{
    private readonly WebView2 browser = new()
    {
        Dock = DockStyle.Fill,
        AllowExternalDrop = true,
        ZoomFactor = 1.0
    };

    public MainForm()
    {
        Text = "TCS UploadFit";
        Icon = LoadApplicationIcon();
        Width = 1360;
        Height = 900;
        MinimumSize = new Size(960, 640);
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = Color.FromArgb(247, 247, 245);
        Controls.Add(browser);
        Load += BrowserFormLoad;
    }

    private static Icon LoadApplicationIcon()
    {
        var iconPath = Path.Combine(AppContext.BaseDirectory, "wwwroot", "assets", "pwa-512.png");
        if (!File.Exists(iconPath))
            throw new FileNotFoundException("The TCS UploadFit application icon is missing.", iconPath);

        using var source = new Bitmap(iconPath);
        using var iconBitmap = new Bitmap(256, 256);
        using (var graphics = Graphics.FromImage(iconBitmap))
        {
            graphics.Clear(Color.Transparent);
            graphics.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic;
            graphics.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.HighQuality;
            graphics.DrawImage(source, new Rectangle(0, 0, 256, 256));
        }

        var nativeIcon = iconBitmap.GetHicon();
        try
        {
            using var icon = Icon.FromHandle(nativeIcon);
            return (Icon)icon.Clone();
        }
        finally
        {
            DestroyIcon(nativeIcon);
        }
    }

    [DllImport("user32.dll", SetLastError = true)]
    [return: System.Runtime.InteropServices.MarshalAs(System.Runtime.InteropServices.UnmanagedType.Bool)]
    private static extern bool DestroyIcon(IntPtr handle);

    private async void BrowserFormLoad(object? sender, EventArgs e)
    {
        try
        {
            var userData = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "TCS UploadFit",
                "WebView2");
            Directory.CreateDirectory(userData);

            var runtimeVersion = CoreWebView2Environment.GetAvailableBrowserVersionString();
            if (string.IsNullOrWhiteSpace(runtimeVersion))
                throw new InvalidOperationException("Microsoft Edge WebView2 Evergreen Runtime is not installed.");

            var environment = await CoreWebView2Environment.CreateAsync(userDataFolder: userData);
            await browser.EnsureCoreWebView2Async(environment);

            var appFiles = Path.Combine(AppContext.BaseDirectory, "wwwroot");
            if (!File.Exists(Path.Combine(appFiles, "index.html")))
                throw new FileNotFoundException("The packaged UploadFit application files are missing.", appFiles);

            var core = browser.CoreWebView2;
            core.SetVirtualHostNameToFolderMapping(
                "uploadfit.example",
                appFiles,
                CoreWebView2HostResourceAccessKind.Allow);

            core.Settings.AreDevToolsEnabled = false;
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.AreDefaultContextMenusEnabled = false;
            core.Settings.IsZoomControlEnabled = true;

            core.NavigationStarting += (_, args) =>
            {
                if (Uri.TryCreate(args.Uri, UriKind.Absolute, out var target)
                    && string.Equals(target.Scheme, "mailto", StringComparison.OrdinalIgnoreCase))
                {
                    args.Cancel = true;
                    try
                    {
                        Process.Start(new ProcessStartInfo(args.Uri) { UseShellExecute = true });
                    }
                    catch
                    {
                        MessageBox.Show(this, "No default email application is configured.", "TCS UploadFit",
                            MessageBoxButtons.OK, MessageBoxIcon.Information);
                    }
                    return;
                }

                if (!Uri.TryCreate(args.Uri, UriKind.Absolute, out target)
                    || target.Scheme != Uri.UriSchemeHttps
                    || !string.Equals(target.Host, "uploadfit.example", StringComparison.OrdinalIgnoreCase))
                {
                    args.Cancel = true;
                }
            };

            core.NewWindowRequested += (_, args) => args.Handled = true;
            core.DownloadStarting += BrowserDownloadStarting;
            core.ProcessFailed += (_, _) =>
            {
                MessageBox.Show(this,
                    "The image workspace stopped unexpectedly. Close and reopen TCS UploadFit.",
                    "TCS UploadFit", MessageBoxButtons.OK, MessageBoxIcon.Error);
            };

            core.Navigate("https://uploadfit.example/index.html");
        }
        catch (Exception error)
        {
            browser.Visible = false;
            MessageBox.Show(this,
                "TCS UploadFit could not start its local workspace. Check that Microsoft Edge WebView2 Runtime is installed, then reopen the app.\n\nDetails: " + error.Message,
                "TCS UploadFit", MessageBoxButtons.OK, MessageBoxIcon.Error);
            Close();
        }
    }

    private void BrowserDownloadStarting(object? sender, CoreWebView2DownloadStartingEventArgs args)
    {
        using var dialog = new SaveFileDialog
        {
            FileName = Path.GetFileName(args.ResultFilePath),
            Filter = "All files (*.*)|*.*",
            AddExtension = false,
            OverwritePrompt = true,
            Title = "Save prepared image or ZIP"
        };

        if (string.IsNullOrWhiteSpace(dialog.FileName))
            dialog.FileName = "TCS-UploadFit-export";

        if (dialog.ShowDialog(this) == DialogResult.OK)
            args.ResultFilePath = dialog.FileName;
        else
            args.Cancel = true;
        args.Handled = true;
    }
}
