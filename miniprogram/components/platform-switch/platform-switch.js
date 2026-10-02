Component({
  properties: {
    platform: { type: String, value: 'fanqie' },
  },
  methods: {
    onTap(e) {
      const p = e.currentTarget.dataset.p;
      if (p === this.data.platform) return;
      this.setData({ platform: p });
      this.triggerEvent('change', { platform: p });
    },
  },
});
