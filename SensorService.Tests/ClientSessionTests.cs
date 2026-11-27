// LOQ Monitor | Tests of one connected client
// Author: cahyata
// Copyright (c) 2026 cahyata
using System.Net.WebSockets;
using System.Text;
using System.Threading.Channels;
using Xunit;

public sealed class ClientSessionTests
{
    static readonly TimeSpan Long = TimeSpan.FromSeconds(30);

    sealed class Counted : IOnDemand
    {
        public int Acquired, Released;
        public void Acquire() => Interlocked.Increment(ref Acquired);
        public void Release() => Interlocked.Increment(ref Released);
    }

    /// <summary>A socket the test drives: it pushes what the client says and decides when a send finishes.
    /// Like the real one, it does not end a pending receive or send by itself when it is aborted.</summary>
    sealed class FakeSocket : WebSocket
    {
        readonly Channel<(WebSocketMessageType Type, string Text)> _incoming = Channel.CreateUnbounded<(WebSocketMessageType, string)>();
        public readonly List<string> Sent = new();
        public TaskCompletionSource? Stall;      // while set, a send does not finish
        public int SendsStarted;
        public bool Aborted;
        WebSocketState _state = WebSocketState.Open;

        public void Says(string text) => _incoming.Writer.TryWrite((WebSocketMessageType.Text, text));
        public void Leaves() => _incoming.Writer.TryWrite((WebSocketMessageType.Close, ""));
        public void Breaks() => _incoming.Writer.TryComplete(new WebSocketException("gone"));

        public override async Task<WebSocketReceiveResult> ReceiveAsync(ArraySegment<byte> buffer, CancellationToken ct)
        {
            (WebSocketMessageType type, string text) = (default, "");
            try { (type, text) = await _incoming.Reader.ReadAsync(CancellationToken.None); }
            catch (ChannelClosedException e) when (e.InnerException is WebSocketException gone) { throw gone; }
            var n = Encoding.UTF8.GetBytes(text, buffer);
            return new WebSocketReceiveResult(n, type, true);
        }

        public override async Task SendAsync(ArraySegment<byte> buffer, WebSocketMessageType type, bool end, CancellationToken ct)
        {
            Interlocked.Increment(ref SendsStarted);
            if (Stall is { } stall) await stall.Task;
            lock (Sent) Sent.Add(Encoding.UTF8.GetString(buffer));
        }

        public override void Abort() { Aborted = true; _state = WebSocketState.Aborted; }
        public override WebSocketState State => _state;
        public override WebSocketCloseStatus? CloseStatus => null;
        public override string? CloseStatusDescription => null;
        public override string? SubProtocol => null;
        public override Task CloseAsync(WebSocketCloseStatus s, string? d, CancellationToken ct) => Task.CompletedTask;
        public override Task CloseOutputAsync(WebSocketCloseStatus s, string? d, CancellationToken ct) => Task.CompletedTask;
        public override void Dispose() { }
    }

    sealed class Setup
    {
        public readonly FakeSocket Socket = new();
        public readonly Counted Fps = new(), Net = new();
        public int Resets;
        public readonly CancellationTokenSource Service = new();
        public readonly ClientSession Session;
        public Setup(TimeSpan? sendLimit = null) =>
            Session = new ClientSession(Socket, new Dictionary<string, IOnDemand> { ["fps"] = Fps, ["net"] = Net }, () => Resets++, sendLimit ?? Long);
    }

    static byte[] Bytes(string s) => Encoding.UTF8.GetBytes(s);

    static async Task Until(Func<bool> done)
    {
        for (var i = 0; i < 500 && !done(); i++) await Task.Delay(10);
        Assert.True(done(), "did not happen in time");
    }

    static Task Ends(Task session) => session.WaitAsync(TimeSpan.FromSeconds(5));

    [Fact]
    public async Task Asks_once_and_releases_once()
    {
        var s = new Setup();
        var run = s.Session.Run(s.Service.Token);
        foreach (var command in new[] { "fps-on", "fps-on", "fps-off", "fps-off", "net-off" }) s.Socket.Says(command);
        s.Socket.Leaves();
        await Ends(run);
        Assert.Equal((1, 1, 0, 0), (s.Fps.Acquired, s.Fps.Released, s.Net.Acquired, s.Net.Released));
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Releases_what_it_held_when_the_client_goes_away(bool abruptly)
    {
        var s = new Setup();
        var run = s.Session.Run(s.Service.Token);
        s.Socket.Says("fps-on");
        s.Socket.Says("net-on");
        if (abruptly) s.Socket.Breaks(); else s.Socket.Leaves();
        await Ends(run);
        Assert.Equal((1, 1), (s.Fps.Released, s.Net.Released));
    }

    [Fact]
    public async Task Ends_and_releases_when_the_service_stops()
    {
        var s = new Setup();
        var run = s.Session.Run(s.Service.Token);
        s.Socket.Says("net-on");
        await Until(() => s.Net.Acquired == 1);
        s.Service.Cancel();
        await Ends(run);
        Assert.Equal(1, s.Net.Released);
    }

    [Fact]
    public async Task Restarts_min_and_max_and_ignores_anything_else()
    {
        var s = new Setup();
        var run = s.Session.Run(s.Service.Token);
        foreach (var command in new[] { "reset-minmax", "procs-on", "fps", "fps-maybe", "-on", "", "set-fan-100" }) s.Socket.Says(command);
        s.Socket.Leaves();
        await Ends(run);
        Assert.Equal((1, 0, 0), (s.Resets, s.Fps.Acquired, s.Net.Acquired));
    }

    [Fact]
    public async Task Sends_the_posted_snapshot()
    {
        var s = new Setup();
        s.Session.Post(Bytes("first"));
        var run = s.Session.Run(s.Service.Token);
        await Until(() => s.Socket.Sent.Count == 1);
        s.Session.Post(Bytes("second"));
        await Until(() => s.Socket.Sent.Count == 2);
        s.Socket.Leaves();
        await Ends(run);
        Assert.Equal(new[] { "first", "second" }, s.Socket.Sent);
    }

    [Fact]
    public async Task A_slow_client_gets_only_the_newest_snapshot()
    {
        var s = new Setup();
        var stall = s.Socket.Stall = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var run = s.Session.Run(s.Service.Token);
        s.Session.Post(Bytes("1"));
        await Until(() => s.Socket.SendsStarted == 1);
        foreach (var n in new[] { "2", "3", "4" }) s.Session.Post(Bytes(n));    // none of these waits
        s.Socket.Stall = null;
        stall.SetResult();
        await Until(() => s.Socket.Sent.Count == 2);
        s.Socket.Leaves();
        await Ends(run);
        Assert.Equal(new[] { "1", "4" }, s.Socket.Sent);
    }

    [Fact]
    public async Task A_stuck_client_is_dropped_and_released()
    {
        var s = new Setup(TimeSpan.FromMilliseconds(200));
        s.Socket.Stall = new TaskCompletionSource();
        var run = s.Session.Run(s.Service.Token);
        s.Socket.Says("fps-on");
        await Until(() => s.Fps.Acquired == 1);
        s.Session.Post(Bytes("never read"));
        await Ends(run);      // although the client never closes and the pending receive never returns
        Assert.True(s.Socket.Aborted);
        Assert.Equal(1, s.Fps.Released);
    }
}
