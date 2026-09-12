




document.addEventListener('DOMContentLoaded', function () {


  /*
   * =====================================================
   * LINE-UP
   * Ein Fahrer darf nur einmal verwendet werden.
   * =====================================================
   */

  const lineupSelects = Array.from(
    document.querySelectorAll(
      '.season-lineup-driver-select'
    )
  );


  function updateLineupDriverOptions() {

  const selectedDrivers = new Set();

  lineupSelects.forEach(function (select) {
    if (select.value) {
      selectedDrivers.add(select.value);
    }
  });

  lineupSelects.forEach(function (select) {

    Array.from(select.options).forEach(function (option) {

      if (!option.value) {
        option.disabled = false;
        option.hidden = false;
        return;
      }

      if (option.value === select.value) {
        option.disabled = false;
        option.hidden = false;
        return;
      }

      const used =
        selectedDrivers.has(option.value);

      option.disabled = used;
      option.hidden = used;
    });

  });

}

  lineupSelects.forEach(function (select) {

    select.addEventListener(
      'change',
      updateLineupDriverOptions
    );

  });


  updateLineupDriverOptions();

});
